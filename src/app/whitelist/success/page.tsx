import { redirect } from "next/navigation";
import Link from "next/link";
import type Stripe from "stripe";
import {
    ArrowUpRight,
    Check,
    CheckCircle2,
} from "lucide-react";
import { retrieveSession } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { fulfillMembership } from "@/lib/membership-fulfillment";
import { TIERS, isTierKey } from "@/lib/whitelist";
import AnimatedCheck from "@/components/effects/AnimatedCheck";
import Confetti from "@/components/effects/Confetti";
import ShineBorder from "@/components/effects/ShineBorder";
import FoundingSuccessPending from "@/components/FoundingSuccessPending";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ session_id?: string }>;

function formatMoney(
    amountCents: number | null | undefined,
    currency: string | null | undefined,
): string {
    const code = (currency ?? "usd").toUpperCase();
    if (amountCents == null) {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: code,
            minimumFractionDigits: 0,
        }).format(0);
    }
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        minimumFractionDigits: 0,
    }).format(amountCents / 100);
}

function receiptUrlFrom(session: Stripe.Checkout.Session): string | null {
    const pi = session.payment_intent;
    if (!pi || typeof pi === "string") return null;
    const charge = pi.latest_charge;
    if (!charge || typeof charge === "string") return null;
    return charge.receipt_url ?? null;
}

export default async function WhitelistSuccessPage({
    searchParams,
}: {
    searchParams: SearchParams;
}) {
    const { session_id } = await searchParams;
    if (!session_id || !/^cs_[a-zA-Z0-9_]+$/.test(session_id) || session_id.length > 255) redirect("/whitelist");
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login?next=' + encodeURIComponent('/whitelist/success?session_id=' + session_id));

    let session: Stripe.Checkout.Session;
    try {
        session = await retrieveSession(session_id);
    } catch {
        redirect("/whitelist?error=checkout_failed");
    }

    if (session.metadata?.user_id !== user.id || session.client_reference_id !== user.id || session.metadata?.fulfillment_version !== 'account_v1') redirect('/whitelist?error=unverified_purchase');
    const tierKey = session.metadata?.tier;

    if (!isTierKey(tierKey)) {
        redirect("/whitelist");
    }

    const tier = TIERS[tierKey];
    const amount = formatMoney(session.amount_total, session.currency);
    const email =
        session.customer_details?.email ?? session.customer_email ?? null;
    const receiptUrl = receiptUrlFrom(session);
    let ready = false;
    let invalid = false;
    try {
        const result = await fulfillMembership(session_id, user.id, false);
        invalid = result.status === 'invalid';
        ready = result.status === 'fulfilled';
    } catch { /* The authenticated status component retries transient fulfillment failures. */ }
    if (invalid) redirect('/whitelist?error=unverified_purchase');

    return (
        <div className="waitlist-page">
            <section className="waitlist-hero">
                <div className="waitlist-backdrop" aria-hidden="true">
                    <div className="waitlist-orb" />
                    <div className="waitlist-grid" />
                </div>

                <div className="container-vspr relative z-10">
                    <div className="whitelist-success-panel waitlist-founding-panel">
                        {ready && <Confetti trigger={session_id} />}
                        <ShineBorder duration={10} />
                        <div
                            className="waitlist-founding-grid"
                            aria-hidden="true"
                        />
                        <div
                            className="waitlist-founding-glow"
                            aria-hidden="true"
                        />
                        <div className="waitlist-founding-ornament">
                            <div
                                className="waitlist-founding-ornament-ring"
                                aria-hidden="true"
                            />
                            <div
                                className="waitlist-founding-ornament-ring waitlist-founding-ornament-ring--outer"
                                aria-hidden="true"
                            />
                            <AnimatedCheck
                                size={44}
                                className="waitlist-founding-ornament-icon"
                            />
                        </div>

                        <div className="waitlist-founding-content">
                            <span className="waitlist-kicker waitlist-founding-kicker">
                                <CheckCircle2
                                    size={14}
                                    className="whitelist-success-check"
                                />
                                {ready ? 'Membership active' : 'Checkout status'}
                            </span>

                            <h1 className="waitlist-founding-title">
                                {ready ? "You're in." : 'Finishing checkout.'}
                                <br />
                                <span className="text-muted">
                                    {ready ? 'Welcome, founder.' : 'Your account benefits.'}
                                </span>
                            </h1>

                            <FoundingSuccessPending sessionId={session_id} initiallyReady={ready} tier={tierKey} />

                            <p className="waitlist-founding-copy mt-6">
                                Payment total: {amount} for your{" "}
                                {tier.label} membership
                                {email ? (
                                    <>
                                        . Checkout email:{" "}
                                        <span className="whitelist-success-email">
                                            {email}
                                        </span>
                                        .
                                    </>
                                ) : (
                                    "."
                                )}
                            </p>

                            <div className="waitlist-founding-stats">
                                <div className="waitlist-founding-stat">
                                    <span className="waitlist-founding-stat-value">
                                        {tier.label}
                                    </span>
                                    <span className="waitlist-founding-stat-label">
                                        Your tier
                                    </span>
                                </div>
                                <span
                                    className="waitlist-founding-stat-sep"
                                    aria-hidden="true"
                                />
                                <div className="waitlist-founding-stat">
                                    <span className="waitlist-founding-stat-value">
                                        {amount}
                                    </span>
                                    <span className="waitlist-founding-stat-label">
                                        One-time
                                    </span>
                                </div>
                                <span
                                    className="waitlist-founding-stat-sep"
                                    aria-hidden="true"
                                />
                                <div className="waitlist-founding-stat">
                                    <span className="waitlist-founding-stat-value">
                                        {tier.boostsPerMonth}/mo
                                    </span>
                                    <span className="waitlist-founding-stat-label">
                                        Boosts, forever
                                    </span>
                                </div>
                            </div>

                            <ul className="whitelist-success-list">
                                <li>
                                    <Check
                                        size={16}
                                        className="whitelist-success-check"
                                    />
                                    <span>
                                        Your badge and monthly boosts are applied
                                        automatically to your purchasing account.
                                    </span>
                                </li>
                                <li>
                                    <Check
                                        size={16}
                                        className="whitelist-success-check"
                                    />
                                    <span>
                                        No renewals or subscription. This is
                                        yours forever.
                                    </span>
                                </li>
                            </ul>

                            <div className="whitelist-success-ctas">
                                <Link href="/profile" className="pill-btn">
                                    View your profile
                                </Link>
                                {receiptUrl && (
                                    <a
                                        href={receiptUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="pill-btn pill-btn-outline"
                                    >
                                        View Stripe receipt
                                        <ArrowUpRight size={15} />
                                    </a>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <div className="home-section-tail" aria-hidden="true" />
        </div>
    );
}
