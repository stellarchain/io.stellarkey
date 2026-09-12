'use client';

import { useEffect, useRef } from 'react';
import { Button, ModalFooter } from '@/components/ui';
import { IconExternal } from '@/components/icons';
import { triggerHaptic } from '@/lib/haptics';

const CONFETTI_COLORS = ['#0A84FF', '#64D2FF', '#30D158', '#FFD60A', '#5E5CE6'];

/**
 * Spawns a one-shot confetti burst. The pieces mount inside the dialog
 * overlay that celebrates (falling back to the body outside a dialog) so they
 * fade and leave with the sheet instead of outliving it on the page. DOM-only
 * so it costs nothing when unused; honors reduced motion by not spawning.
 */
function burstConfetti(origin: HTMLElement | null): void {
  if (typeof document === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // The overlay (not the scrolling shell) keeps `position: fixed` viewport
  // sized while still unmounting and fading together with the dialog.
  const host = origin?.closest<HTMLElement>('[data-modal-backdrop]') ?? document.body;
  const pieces: HTMLElement[] = [];
  for (let index = 0; index < 36; index += 1) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
    piece.style.setProperty('--confetti-drift', `${(Math.random() - 0.5) * 160}px`);
    piece.style.setProperty('--confetti-spin', `${360 + Math.random() * 540}deg`);
    piece.style.setProperty('--confetti-duration', `${1.8 + Math.random() * 1.2}s`);
    piece.style.animationDelay = `${Math.random() * 0.35}s`;
    host.appendChild(piece);
    pieces.push(piece);
  }
  window.setTimeout(() => {
    for (const piece of pieces) piece.remove();
  }, 3800);
}

/**
 * The shared terminal success moment for every private flow: a circle pops in,
 * the check draws itself, and the chime + haptic land exactly as the stroke
 * completes. `celebrate` adds the one-shot confetti reserved for first-ever
 * events.
 */
export function PrivateSuccess({
  title,
  subtitle,
  explorerHref,
  celebrate = false,
  onDone,
  doneLabel = 'Done',
}: {
  title: string;
  subtitle?: string;
  explorerHref?: string;
  celebrate?: boolean;
  onDone(): void;
  doneLabel?: string;
}) {
  const firedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    // The stroke finishes at ~420ms (120ms delay + 300ms draw).
    const timer = window.setTimeout(() => {
      triggerHaptic('success');
      if (celebrate) burstConfetti(rootRef.current);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [celebrate]);

  return (
    <div ref={rootRef} className="flex flex-col items-center py-4 text-center">
      <span className="success-circle flex h-16 w-16 items-center justify-center rounded-full border border-[#30D158]/30 bg-[#30D158]/10 text-[#30D158]">
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden>
          <path
            className="success-check"
            d="M7 15.5 L13 21.5 L23 9.5"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <p className="display-h mt-4 text-xl font-light text-white">{title}</p>
      {subtitle ? (
        <p className="mt-1 max-w-[340px] text-[13px] leading-relaxed text-neutral-400">{subtitle}</p>
      ) : null}
      {explorerHref ? (
        <a className="chip mt-4 tap" href={explorerHref} target="_blank" rel="noopener noreferrer">
          View on Explorer <IconExternal size={11} />
        </a>
      ) : null}
      <ModalFooter
        className="w-full"
        primary={
          <Button type="button" variant="ghost" onClick={onDone}>
            {doneLabel}
          </Button>
        }
      />
    </div>
  );
}
