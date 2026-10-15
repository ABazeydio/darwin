"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight, Mail, X } from "lucide-react";

export default function VerificationDialog({ email, next, onClose }: {
  email: string;
  next?: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const loginHref = next?.startsWith("/") && !next.startsWith("//")
    ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <dialog ref={dialogRef} className="verification-dialog" aria-labelledby="verification-title"
      aria-describedby="verification-description" onCancel={onClose}>
      <button type="button" className="profile-modal-close verification-dialog__close"
        aria-label="Close verification message" onClick={onClose}>
        <X size={18} />
      </button>
      <div className="verification-dialog__icon" aria-hidden="true"><Mail size={30} strokeWidth={1.5} /></div>
      <p className="section-label">One last step to Darwin</p>
      <h2 id="verification-title">Check your inbox.</h2>
      <p id="verification-description" className="verification-dialog__copy">
        Verify your account using the link sent to <strong>{email}</strong>, then sign in to complete setup.
      </p>
      <p className="verification-dialog__hint">Can’t find it? Check your spam or junk folder.</p>
      <Link href={loginHref} className="pill-btn">Continue to sign in <ArrowRight size={16} /></Link>
      <button type="button" className="verification-dialog__dismiss" onClick={onClose}>Got it</button>
    </dialog>
  );
}
