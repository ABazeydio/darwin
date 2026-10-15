'use client';
import { use, useState, useEffect, useCallback, Suspense } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Heart,
  MapPin,
  Share2,
  Shield,
  Clock,
  Pencil,
} from 'lucide-react';
import BoostListingButton from '@/components/BoostListingButton';
import { loadBoostStatus } from '@/app/profile/founding-actions';
import type { BoostStatus } from '@/lib/boost-types';
import { useMarketplaceRefresh } from '@/lib/use-marketplace-refresh';
import MessageSellerButton from '@/components/MessageSellerButton';
import ListingFeedback from '@/components/ListingFeedback';
import Link from 'next/link';
import { getConditionClass, Listing, Category, Condition } from '@/lib/data';
import Image from 'next/image';
import PageTransition from '@/components/PageTransition';
import { createClient } from '@/lib/supabase/client';

const ease = [0.16, 1, 0.3, 1] as const;

function stagger(i: number, base = 0.15) {
  return { duration: 0.6, delay: base + i * 0.08, ease };
}

export default function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [listing, setListing] = useState<Listing | null>(null);
  const [listingUserId, setListingUserId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [benefits, setBenefits] = useState<BoostStatus | null>(null);
  const [listingStatus, setListingStatus] = useState('active');
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  useMarketplaceRefresh(refresh);
  const [loading, setLoading] = useState(true);
  const [isSaved, setIsSaved] = useState(false);
  const [savePending, setSavePending] = useState(false);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isDbListing = UUID_RE.test(id);

  useEffect(() => {
    async function fetchDbListing() {
      try {
        const supabase = createClient();
        const [{ data, error }, { data: authData }] = await Promise.all([
          supabase
            .from('listings')
            .select('*, seller:profiles(id, first_name, full_name, avatar_url, whitelist_tier)')
            .eq('id', id)
            .maybeSingle(),
          supabase.auth.getUser(),
        ]);

        if (error) {
          console.error('Error fetching listing:', error);
          return;
        }

        setCurrentUserId(authData.user?.id ?? null);

        if (data) {
          setListingStatus(data.status);
          if (authData.user?.id === data.user_id) {
            setBenefits(await loadBoostStatus());
          }
          const sellerRaw = data.seller;
          const sellerMeta = Array.isArray(sellerRaw)
            ? sellerRaw[0] ?? {}
            : sellerRaw ?? {};
          const sellerName = sellerMeta.full_name || sellerMeta.first_name || 'Student';
          const imageUrls = Array.isArray(data.image_urls) && data.image_urls.length > 0
            ? data.image_urls
            : data.image_url
              ? [data.image_url]
              : [];

          setListingUserId(data.user_id);
          setListing({
            id: data.id,
            title: data.title,
            price: data.price,
            category: (data.category as Category) || 'Other',
            condition: (data.condition as Condition) || 'New',
            description: data.description || '',
            image: imageUrls[0] || '/images/textbook.svg',
            seller: {
              tier: sellerMeta.whitelist_tier,
              id: sellerMeta.id || '',
              name: sellerName,
              avatar: sellerMeta.avatar_url || '/avatars/1.jpg',
              campus: data.campus || 'Main Campus',
            },
            boostedUntil: data.boosted_until,
            createdAt: data.created_at,
            saved: false,
          });
        }
      } catch (err) {
        console.error('Fetch error:', err);
      } finally {
        setLoading(false);
      }
    }

    if (isDbListing) {
      fetchDbListing();
    } else {
      setLoading(false);
    }
  }, [id, isDbListing, refreshKey]);

  // Fetch saved state for DB listings
  useEffect(() => {
    if (!isDbListing) return;
    fetch('/api/saved')
      .then((r) => r.json())
      .then((json) => {
        if (Array.isArray(json.savedIds)) {
          setIsSaved(json.savedIds.includes(id));
        }
      })
      .catch(() => {});
  }, [id, isDbListing]);

  const handleSaveToggle = useCallback(async () => {
    if (savePending || !isDbListing) return;
    const next = !isSaved;
    setIsSaved(next);
    setSavePending(true);
    try {
      const res = await fetch('/api/saved', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: id }),
      });
      if (!res.ok) setIsSaved(isSaved); // revert
    } catch {
      setIsSaved(isSaved); // revert
    } finally {
      setSavePending(false);
    }
  }, [savePending, isDbListing, isSaved, id]);

  if (loading) {
    return (
      <PageTransition>
        <div className="container-vspr page-shell text-center">
          <p className="text-secondary mt-10">Loading listing details...</p>
        </div>
      </PageTransition>
    );
  }

  if (!listing) {
    return (
      <PageTransition>
        <div className="container-vspr page-shell text-center">
          <h1 className="text-4xl font-bold">Not found</h1>
          <p className="text-secondary mt-4">
            This listing doesn&apos;t exist.
          </p>
          <Link href="/browse" className="pill-btn mt-8 inline-flex">
            Back to Browse
          </Link>
        </div>
      </PageTransition>
    );
  }

  const conditionClass = getConditionClass(listing.condition);
  const isOwner = !!currentUserId && currentUserId === listingUserId;

  return (
    <PageTransition>
      <Suspense>
        <ListingFeedback />
      </Suspense>
      <div className="container-vspr page-shell">
        {/* Back nav */}
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.05, ease }}
        >
          <Link
            href="/browse"
            className="text-muted mb-10 inline-flex items-center gap-2 text-sm transition-colors hover:text-white"
          >
            <ArrowLeft size={15} /> Back to listings
          </Link>
        </motion.div>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-16">
          {/* ─── Image column ─── */}
          <motion.div
            className="lg:col-span-7"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={stagger(0, 0.1)}
          >
            <div className="listing-detail-image-wrap">
              <motion.div
                whileHover={{ scale: 1.03 }}
                transition={{
                  duration: 0.6,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
                className="relative w-full h-full"
              >
                <Image
                  src={listing.image}
                  alt={listing.title}
                  fill
                  sizes="(max-width: 1024px) 100vw, 58vw"
                  className="object-cover"
                  priority
                />
              </motion.div>

              {/* Overlay badges */}
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 px-7 py-6 pointer-events-none bg-gradient-to-t from-black/50 to-transparent">
                <span className="category-badge">{listing.category}</span>
                <span className="listing-image-label">Ready for pickup</span>
              </div>
            </div>
          </motion.div>

          {/* ─── Details column ─── */}
          <div className="lg:col-span-5 flex flex-col gap-0">
            {/* Condition pill */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={stagger(1)}
              className="flex items-center gap-3 mb-5"
            >
              <span className="listing-detail-condition">
                <span className={`condition-dot ${conditionClass}`} />
                {listing.condition}
              </span>
            </motion.div>

            {/* Title */}
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={stagger(2)}
              className="text-3xl md:text-[2.5rem] font-bold leading-[1.1] tracking-tight"
            >
              {listing.title}
            </motion.h1>

            {/* Price */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={stagger(3)}
              className="price-tag text-4xl md:text-5xl mt-5"
            >
              ${listing.price}
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={stagger(4)}
              className="divider my-7"
            />

            {/* Description */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={stagger(5)}
            >
              <span className="section-label block mb-3">Description</span>
              <p className="text-secondary text-[15px] leading-relaxed max-w-prose">
                {listing.description}
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={stagger(6)}
              className="divider my-7"
            />

            {/* Seller card */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={stagger(7)}
              className="listing-detail-seller"
            >
              <Link href={`/profile/${listing.seller.id}`} className="flex items-center gap-4 group cursor-pointer">
                <div className="detail-avatar relative overflow-hidden flex items-center justify-center group-hover:border-white/30 transition-colors">
                  {listing.seller.avatar ? (
                    <Image
                      src={listing.seller.avatar}
                      alt={listing.seller.name}
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  ) : (
                    listing.seller.name.charAt(0)
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[15px] group-hover:text-white transition-colors">
                    {listing.seller.name}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1 text-muted text-sm">
                      <MapPin size={13} />
                      {listing.seller.campus}
                    </span>
                  </div>
                </div>
              </Link>
            </motion.div>

            {isOwner && <div className="mt-6"><BoostListingButton listingId={listing.id} boostedUntil={listing.boostedUntil} status={listingStatus} benefits={benefits} /></div>}

            {/* Action buttons */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={stagger(8)}
              className="flex flex-col sm:flex-row gap-3 mt-8"
            >
              {isOwner ? (
                <Link
                  href={`/listing/${listing.id}/edit`}
                  className="pill-btn ui-icon-label min-h-12"
                >
                  <Pencil size={17} />
                  <span>Edit Listing</span>
                </Link>
              ) : (
                <MessageSellerButton
                  listingId={listing.id}
                  sellerId={(listing.seller as { id?: string }).id ?? ''}
                  listingTitle={listing.title}
                />
              )}
              <button
                className="pill-btn pill-btn-outline ui-icon-label min-h-12 transition-colors hover:bg-white/5 hover:border-white/30"
                onClick={handleSaveToggle}
                disabled={savePending || !isDbListing}
                aria-label={isSaved ? 'Unsave listing' : 'Save listing'}
              >
                <Heart
                  size={17}
                  fill={isSaved ? '#f97316' : 'none'}
                  color={isSaved ? '#f97316' : 'currentColor'}
                />
                <span>{isSaved ? 'Saved' : 'Save'}</span>
              </button>
              <button className="pill-btn pill-btn-outline ui-icon-label min-h-12 transition-colors hover:bg-white/5 hover:border-white/30">
                <Share2 size={17} />
              </button>
            </motion.div>

            {/* Trust signals */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={stagger(9)}
              className="mt-8 flex items-center gap-6 text-muted text-xs"
            >
              <span className="flex items-center gap-1.5">
                <Shield size={13} />
                Verified seller
              </span>
              <span className="flex items-center gap-1.5">
                <Clock size={13} />
                Listed{' '}
                {new Date(listing.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </motion.div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
