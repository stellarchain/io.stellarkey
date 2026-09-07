"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { triggerHaptic } from "@/lib/haptics";
import { MODAL_EXIT_DURATION_MS } from "@/lib/motion";
import { calculatePopoverPosition, type PopoverPosition } from "@/lib/popover";
import { tabIndexAfterKey } from "@/lib/tabs";
import { IconCheck, IconChevronDown, IconClose, IconCopy } from "./icons";

/** Shared panel chrome for modal surfaces (Modal, CommandPalette). */
export const MODAL_PANEL_CLASS =
  "rounded-[28px] border border-white/[0.12] bg-[#121214]/95 shadow-[0_25px_70px_-15px_rgba(0,0,0,0.9)] backdrop-blur-2xl";

/** Shared chrome for floating popover surfaces (Select, Dropdown). */
const POPOVER_PANEL_CLASS =
  "menu-pop fixed z-[70] overflow-y-auto overscroll-contain rounded-2xl border border-white/[0.12] bg-[#1e1e22]/95 p-1.5 shadow-[0_24px_60px_-18px_rgba(0,0,0,0.9)] backdrop-blur-2xl";

export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: string | null;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "right";
}) {
  const tooltipId = React.useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = !!label && (hovered || focused) && !dismissed;
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    bridgeEdge: "top" | "bottom" | "left" | "right";
  } | null>(null);
  const describedBy = [children.props["aria-describedby"], label ? tooltipId : null]
    .filter(Boolean)
    .join(" ") || undefined;
  const trigger = React.cloneElement(children, { "aria-describedby": describedBy });

  if (!label && (hovered || focused || dismissed)) {
    setHovered(false);
    setFocused(false);
    setDismissed(false);
  }

  function startHover() {
    setHovered(true);
    setDismissed(false);
  }

  function leaveHover(event: React.PointerEvent<HTMLSpanElement>) {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || (!anchorRef.current?.contains(next) && !tooltipRef.current?.contains(next))) {
      setHovered(false);
    }
  }

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const container = anchor.closest<HTMLElement>("[data-modal-backdrop]") ?? document.body;
    setPortalContainer(container);
    const tooltip = tooltipRef.current;
    if (!tooltip) return;

    const margin = 8;
    const gap = 8;
    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
    const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
    let left: number;
    let top: number;
    let bridgeEdge: "top" | "bottom" | "left" | "right" = "bottom";

    if (side === "right") {
      left = anchorRect.right + gap;
      bridgeEdge = "left";
      if (left + tooltipRect.width > viewportRight - margin) {
        left = anchorRect.left - tooltipRect.width - gap;
        bridgeEdge = "right";
      }
      top = anchorRect.top + (anchorRect.height - tooltipRect.height) / 2;
    } else {
      left = anchorRect.left + (anchorRect.width - tooltipRect.width) / 2;
      top = anchorRect.top - tooltipRect.height - gap;
      if (top < viewportTop + margin) {
        top = anchorRect.bottom + gap;
        bridgeEdge = "top";
      }
    }

    // A modal backdrop establishes a fixed containing block for its portal.
    const bounds = container === document.body ? null : container.getBoundingClientRect();
    setPosition({
      left: Math.min(
        Math.max(viewportLeft + margin, left),
        Math.max(viewportLeft + margin, viewportRight - tooltipRect.width - margin),
      ) - (bounds?.left ?? 0),
      top: Math.min(
        Math.max(viewportTop + margin, top),
        Math.max(viewportTop + margin, viewportBottom - tooltipRect.height - margin),
      ) - (bounds?.top ?? 0),
      bridgeEdge,
    });
  }, [side]);

  useLayoutEffect(() => {
    if (!open || !label) return;
    const viewport = window.visualViewport;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    viewport?.addEventListener("resize", updatePosition);
    viewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      viewport?.removeEventListener("resize", updatePosition);
      viewport?.removeEventListener("scroll", updatePosition);
    };
  }, [label, open, portalContainer, updatePosition]);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!open || !anchor) return;
    // Body-portalled content can retain hover after its source becomes inert.
    const dismissWhenInert = () => {
      if (anchor.closest('[inert]')) setDismissed(true);
    };
    const observer = new MutationObserver(dismissWhenInert);
    for (let source: HTMLElement | null = anchor; source; source = source.parentElement) {
      observer.observe(source, { attributes: true, attributeFilter: ['inert'] });
    }
    dismissWhenInert();
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const owner = anchorRef.current?.closest<HTMLElement>("[data-modal-backdrop]") ?? null;
      if (owner ? !isTopModal(owner) : modalStack.length > 0) return;
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  if (!label) return trigger;

  const tooltip = open && portalContainer
    ? createPortal(
        <span
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          onPointerEnter={startHover}
          onPointerLeave={leaveHover}
          style={{
            position: "fixed",
            left: position?.left ?? 0,
            top: position?.top ?? 0,
            visibility: position ? "visible" : "hidden",
          }}
          className="z-[90] w-max max-w-52 rounded-lg border border-white/[0.12] bg-[#27272b]/95 px-2.5 py-1.5 text-center text-[11px] font-semibold leading-tight text-white shadow-xl backdrop-blur-xl"
        >
          {/* Cover the visual gap without a timer or a focusable target. */}
          <span aria-hidden="true" className="absolute" style={position?.bridgeEdge === "bottom" || position?.bridgeEdge === "top"
            ? { left: 0, right: 0, [position.bridgeEdge === "bottom" ? "top" : "bottom"]: "100%", height: 9 }
            : { top: 0, bottom: 0, [position?.bridgeEdge === "left" ? "right" : "left"]: "100%", width: 9 }} />
          {label}
        </span>,
        portalContainer,
      )
    : null;

  return (
    <span
      ref={anchorRef}
      onPointerEnter={startHover}
      onPointerLeave={leaveHover}
      onFocusCapture={() => { setFocused(true); setDismissed(false); }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      className={side === "right"
        ? "relative flex w-full justify-center"
        : "relative inline-flex"}
    >
      {trigger}
      {tooltip}
    </span>
  );
}

export function IOSBackButton({
  onClick,
  label = "Back",
  disabled = false,
  className = "",
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        triggerHaptic("selection");
        onClick();
      }}
      className={`group flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-opacity active:opacity-60 disabled:pointer-events-none disabled:opacity-35 ${className}`}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.09] text-[#0A84FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_5px_18px_-8px_rgba(0,0,0,0.8)] backdrop-blur-2xl transition-colors group-hover:bg-white/[0.14]">
        <IconChevronDown size={21} className="rotate-90" />
      </span>
    </button>
  );
}

const ModalLabelContext = React.createContext<{
  titleId: string;
  descriptionId: string;
} | null>(null);

/* Reference-counted body scroll lock so nested overlays don't fight. */
let scrollLockCount = 0;
let bodyOverflowBeforeLock = "";
let lockedScrollOwner: HTMLElement | null = null;
let scrollOwnerOverflowBeforeLock = "";
const modalStack: HTMLElement[] = [];
let inertAppSurface: HTMLElement | null = null;
let appSurfaceInertBeforeModal = false;
let latestPointerTarget: HTMLElement | null = null;

const pointerCaptureDocument = typeof document === "undefined"
  ? null
  : document as Document & { __stellarkeyOverlayPointerCapture?: boolean };
if (pointerCaptureDocument && !pointerCaptureDocument.__stellarkeyOverlayPointerCapture) {
  pointerCaptureDocument.__stellarkeyOverlayPointerCapture = true;
  pointerCaptureDocument.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest(
          'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
      : null;
    latestPointerTarget = target instanceof HTMLElement ? target : null;
  }, true);
}

function syncModalInertness() {
  if (modalStack.length > 0 && !inertAppSurface) {
    inertAppSurface = document.querySelector<HTMLElement>("[data-app-surface]");
    if (inertAppSurface) {
      appSurfaceInertBeforeModal = inertAppSurface.inert;
      inertAppSurface.inert = true;
    }
  }

  const top = modalStack.at(-1) ?? null;
  for (const modal of modalStack) {
    modal.inert = modal !== top;
  }

  if (modalStack.length === 0 && inertAppSurface) {
    inertAppSurface.inert = appSurfaceInertBeforeModal;
    inertAppSurface = null;
    appSurfaceInertBeforeModal = false;
  }
}

function registerModal(modal: HTMLElement) {
  if (!modalStack.includes(modal)) modalStack.push(modal);
  syncModalInertness();
}

function unregisterModal(modal: HTMLElement) {
  const index = modalStack.lastIndexOf(modal);
  if (index >= 0) modalStack.splice(index, 1);
  modal.inert = false;
  syncModalInertness();
}

function isTopModal(modal: HTMLElement | null): boolean {
  return modal !== null && modalStack.at(-1) === modal;
}

function lockBodyScroll() {
  scrollLockCount += 1;
  if (scrollLockCount !== 1) return;
  bodyOverflowBeforeLock = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  lockedScrollOwner = document.querySelector<HTMLElement>("[data-app-scroll-owner]");
  if (lockedScrollOwner) {
    scrollOwnerOverflowBeforeLock = lockedScrollOwner.style.overflow;
    lockedScrollOwner.style.overflow = "hidden";
  }
}
function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount !== 0) return;
  document.body.style.overflow = bodyOverflowBeforeLock;
  if (lockedScrollOwner) {
    lockedScrollOwner.style.overflow = scrollOwnerOverflowBeforeLock;
  }
  lockedScrollOwner = null;
  scrollOwnerOverflowBeforeLock = "";
}

/** Shares the reference-counted Modal scroll lock with full-surface takeovers. */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [active]);
}

export function Modal({
  open,
  onClose,
  children,
  wide = false,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  dismissable?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusFrameRef = useRef<number | null>(null);
  const [visualViewport, setVisualViewport] = useState<{
    offsetTop: number;
    height: number;
  } | null>(null);
  const labelBaseId = React.useId();
  const titleId = `${labelBaseId}-title`;
  const descriptionId = `${labelBaseId}-description`;

  // Stay mounted briefly after `open` flips false so the exit animation plays.
  // (State adjusted during render per https://react.dev/learn/you-might-not-need-an-effect)
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
    }
  }

  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, MODAL_EXIT_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [closing]);

  // Scroll lock + focus restore for as long as the dialog is in the tree.
  useEffect(() => {
    if (!mounted) return;
    if (restoreFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrameRef.current);
      restoreFocusFrameRef.current = null;
    }
    const activeElement = document.activeElement instanceof HTMLElement
      && document.activeElement !== document.body
      ? document.activeElement
      : null;
    restoreFocusRef.current = activeElement ?? latestPointerTarget ?? restoreFocusRef.current;
    latestPointerTarget = null;
    lockBodyScroll();
    window.requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], details > summary:first-of-type, [tabindex]:not([tabindex="-1"])',
      );
      (first ?? panelRef.current)?.focus({ preventScroll: true });
    });
    return () => {
      unlockBodyScroll();
      const restoreTarget = restoreFocusRef.current;
      // WebKit can discard a synchronous focus call while the portal and
      // background inert state are being removed. Restore on the next paint,
      // after the underlying surface is interactive again.
      restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
        restoreFocusFrameRef.current = null;
        if (restoreTarget?.isConnected) {
          restoreTarget.focus({ preventScroll: true });
        }
      });
    };
  }, [mounted]);

  useLayoutEffect(() => {
    if (!mounted || !backdropRef.current) return;
    const modal = backdropRef.current;
    registerModal(modal);
    return () => unregisterModal(modal);
  }, [mounted]);

  // iOS keeps a separate visual viewport while the keyboard is open. Following
  // it prevents a sheet from being centred behind the keyboard or clipped by
  // the browser chrome.
  useEffect(() => {
    if (!mounted) return;
    function update() {
      const viewport = window.visualViewport;
      const next = {
        offsetTop: viewport?.offsetTop ?? 0,
        height: viewport?.height ?? window.innerHeight,
      };
      setVisualViewport(current => {
        if (current?.offsetTop === next.offsetTop && current.height === next.height) {
          return current;
        }
        return next;
      });
    }
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [mounted]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!isTopModal(backdropRef.current)) return;
      if (e.key === "Escape" && dismissable) {
        triggerHaptic("selection");
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusable = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], details > summary:first-of-type, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.offsetParent !== null);
        if (focusable.length === 0) {
          e.preventDefault();
          panelRef.current.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!panelRef.current.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, dismissable]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={backdropRef}
      data-modal-backdrop
      data-overlay-state={closing ? "closing" : "open"}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onMouseDown={(e) => {
        if (e.target === backdropRef.current && dismissable) {
          triggerHaptic("selection");
          onClose();
        }
      }}
      style={
        visualViewport
          ? {
              top: visualViewport.offsetTop,
              bottom: "auto",
              height: visualViewport.height,
            }
          : undefined
      }
      className={`modal-overlay app-safe-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md${closing ? " closing" : ""}`}
    >
      <ModalLabelContext.Provider value={{ titleId, descriptionId }}>
        <div
          ref={panelRef}
          data-modal-shell
          tabIndex={-1}
          style={
            visualViewport
              ? {
                  maxHeight: `calc(${visualViewport.height}px - 2rem - var(--app-safe-area-top))`,
                }
              : undefined
          }
          className={`modal-dialog relative max-h-[90dvh] w-full min-w-0 overflow-y-auto scrollbar-none overscroll-contain ${MODAL_PANEL_CLASS} ${
            wide ? "max-w-xl" : "max-w-md"
          }${closing ? " closing" : ""}`}
        >
          {children}
        </div>
      </ModalLabelContext.Provider>
    </div>,
    document.body,
  );
}

export function ModalHeader({
  title,
  subtitle,
  onClose,
  closeDisabled = false,
}: {
  title: string;
  subtitle?: string;
  onClose?: () => void;
  closeDisabled?: boolean;
}) {
  const labels = React.useContext(ModalLabelContext);
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.08] bg-[#121214]/80 px-4 py-4 backdrop-blur-xl sm:px-6">
      <div>
        <h2 id={labels?.titleId} className="text-[17px] font-bold tracking-tight text-white">{title}</h2>
        {subtitle ? (
          <p id={labels?.descriptionId} className="text-[12px] text-neutral-400 mt-0.5">{subtitle}</p>
        ) : (
          <span id={labels?.descriptionId} className="sr-only">Dialog</span>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          disabled={closeDisabled}
          onClick={() => {
            if (closeDisabled) return;
            triggerHaptic("selection");
            onClose();
          }}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-neutral-400 transition-colors hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9"
          aria-label="Close"
        >
          <IconClose size={14} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Popover engine — shared portal positioning for Select and Dropdown. */
/* ------------------------------------------------------------------ */

function usePopover({
  open,
  onClose,
  anchorRef,
  align = "left",
  matchAnchorWidth = true,
  minWidth = 200,
}: {
  open: boolean;
  onClose: (reason?: "escape" | "outside") => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  align?: "left" | "right";
  matchAnchorWidth?: boolean;
  minWidth?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PopoverPosition | null>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  // Position against the anchor; flip above when space below runs out.
  useEffect(() => {
    if (!open) return;
    function update() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const visualViewport = window.visualViewport;
      const container = anchor.closest<HTMLElement>("[data-modal-backdrop]") ?? document.body;
      setPortalContainer(container);
      const position = calculatePopoverPosition({
        anchor: r,
        viewport: {
          top: visualViewport?.offsetTop ?? 0,
          left: visualViewport?.offsetLeft ?? 0,
          width: visualViewport?.width ?? window.innerWidth,
          height: visualViewport?.height ?? window.innerHeight,
        },
        layoutViewportHeight: window.innerHeight,
        align,
        matchAnchorWidth,
        minWidth,
      });
      // Keep portalled controls inside their owning dialog's accessible and
      // focus subtree. Its backdrop-filter establishes a fixed containing block.
      const bounds = container === document.body ? null : container.getBoundingClientRect();
      setPos(bounds ? {
        ...position,
        left: position.left - bounds.left,
        top: position.top === undefined ? undefined : position.top - bounds.top,
        bottom: position.bottom === undefined ? undefined : position.bottom - (window.innerHeight - bounds.bottom),
      } : position);
    }
    const visualViewport = window.visualViewport;
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    visualViewport?.addEventListener("resize", update);
    visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      visualViewport?.removeEventListener("resize", update);
      visualViewport?.removeEventListener("scroll", update);
    };
  }, [open, anchorRef, align, matchAnchorWidth, minWidth]);

  // Outside-click and Escape dismissal. Escape uses capture + stopPropagation
  // so closing a popover never closes a parent modal underneath it.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose("outside");
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose("escape");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose, anchorRef]);

  return { panelRef, pos, portalContainer };
}

function popoverStyle(pos: PopoverPosition): React.CSSProperties {
  return {
    top: pos.top,
    bottom: pos.bottom,
    left: pos.left,
    width: pos.width,
    maxHeight: pos.maxHeight,
    "--pop-origin": pos.openUp ? "bottom" : "top",
    "--pop-shift": pos.openUp ? "4px" : "-4px",
  } as React.CSSProperties;
}

/** Continue at the trigger's logical position, never at a portalled menu's DOM position. */
function focusAfterPopoverTrigger(anchor: HTMLElement | null, reverse = false): boolean {
  if (!anchor || anchor.closest("[inert]")) return false;
  const owner = anchor.closest<HTMLElement>("[data-modal-shell]") ?? document;
  const stops = Array.from(owner.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, a[href], [tabindex]',
  )).filter(element => element === anchor || (element.tabIndex >= 0 && !element.matches(":disabled")
    && !element.closest("[inert], [data-popover-panel]") && element.getClientRects().length > 0));
  const index = stops.indexOf(anchor);
  if (index < 0) return false;
  const nextIndex = index + (reverse ? -1 : 1);
  const next = stops[nextIndex]
    ?? (owner !== document ? stops[(nextIndex + stops.length) % stops.length] : null);
  if (next && next !== anchor) {
    next.focus({ preventScroll: true });
    return true;
  }
  if (owner !== document) {
    (owner as HTMLElement).focus({ preventScroll: true });
    return true;
  }
  return false;
}

export interface SelectOption {
  value: string;
  label: string;
  /** Right-aligned meta text in the panel row (balance, unit name…). */
  sublabel?: string;
  /** Override for the closed trigger text (defaults to label + sublabel). */
  triggerLabel?: string;
  disabled?: boolean;
}

export function Select({
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled = false,
  size = "md",
  className = "",
  ariaLabel,
  panelMinWidth,
  preserveOptionLabels = false,
}: {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  size?: "md" | "sm";
  className?: string;
  ariaLabel?: string;
  panelMinWidth?: number;
  /** Keep compact identifiers (such as asset codes) complete and truncate metadata first. */
  preserveOptionLabels?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const activeIndex = options.findIndex(option => option.value === activeValue);
  const listboxId = React.useId();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const focusOnOpen = useRef(false);
  const popupHadFocus = useRef(false);
  const typeahead = useRef({ text: "", at: 0 });
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const close = useCallback((reason?: "escape" | "outside") => {
    popupHadFocus.current = false;
    setActiveValue(null);
    setOpen(false);
    if (reason === "escape") anchorRef.current?.focus({ preventScroll: true });
  }, []);
  const { panelRef, pos, portalContainer } = usePopover({
    open,
    onClose: close,
    anchorRef,
    matchAnchorWidth: size === "md",
    minWidth: panelMinWidth ?? 180,
  });

  if (disabled && open) setOpen(false);

  useLayoutEffect(() => {
    if (!disabled || open || !popupHadFocus.current) return;
    popupHadFocus.current = false;
    // Removing a focused option transfers focus to body. Do not attempt to
    // restore its disabled trigger, and never replace a user's newer focus.
    if (document.activeElement === document.body) focusAfterPopoverTrigger(anchorRef.current);
  }, [disabled, open]);

  function openMenu() {
    if (disabled) return;
    triggerHaptic("selection");
    setActiveValue(selected && !selected.disabled
      ? selected.value : options.find(option => !option.disabled)?.value ?? null);
    typeahead.current = { text: "", at: 0 };
    focusOnOpen.current = true;
    setOpen(true);
  }

  function closeMenu(refocus = false) {
    popupHadFocus.current = false;
    setActiveValue(null);
    setOpen(false);
    if (refocus) anchorRef.current?.focus({ preventScroll: true });
  }

  function choose(opt: SelectOption) {
    if (disabled || opt.disabled) return;
    triggerHaptic("selection");
    onChange(opt.value);
    closeMenu(true);
  }

  const positionReady = pos !== null;
  useLayoutEffect(() => {
    if (!open || !positionReady) return;
    const currentOption = options[activeIndex];
    const validOption = !!currentOption && !currentOption.disabled;
    const ownedFocus = popupHadFocus.current && (document.activeElement === document.body
      || panelRef.current?.contains(document.activeElement));
    if (!focusOnOpen.current && !(ownedFocus && (!validOption || document.activeElement === document.body))) return;
    focusOnOpen.current = false;
    const option = panelRef.current?.querySelector<HTMLElement>(validOption
      ? `[data-index="${activeIndex}"]:not([disabled])`
      : '[role="option"]:not([disabled])');
    const target = option ?? panelRef.current;
    if (target !== document.activeElement) target?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: "nearest" });
  }, [open, positionReady, activeIndex, options, panelRef]);

  function focusOption(index: number) {
    if (index < 0 || !options[index] || options[index].disabled) return;
    const option = panelRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: "nearest" });
  }

  function onListboxKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      // WebKit does not reliably resume native Tab at a trigger focused during
      // a portalled key event. Resolve the next owned tab stop explicitly.
      if (focusAfterPopoverTrigger(anchorRef.current, event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        return;
      }
      closeMenu(true);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const direction = event.key === "ArrowUp" || event.key === "End" ? -1 : 1;
      let candidate = event.key === "Home" ? -1 : event.key === "End" ? options.length : activeIndex;
      for (let count = 0; count < options.length; count += 1) {
        candidate = (candidate + direction + options.length) % options.length;
        if (!options[candidate].disabled) { focusOption(candidate); break; }
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      const option = options[activeIndex];
      if (option) choose(option);
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      const buffer = typeahead.current;
      const now = event.timeStamp;
      buffer.text = (now - buffer.at < 600 ? buffer.text : "") + event.key.toLowerCase();
      buffer.at = now;
      focusOption(options.findIndex(option => !option.disabled && option.label.toLowerCase().startsWith(buffer.text)));
    }
  }

  const triggerProps: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    ref: React.RefObject<HTMLButtonElement | null>;
  } = {
    ref: anchorRef,
    id,
    type: "button",
    disabled,
    "aria-haspopup": "listbox",
    "aria-expanded": open,
    "aria-controls": open ? listboxId : undefined,
    "aria-label": ariaLabel,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
    onClick: () => (open ? closeMenu() : openMenu()),
    onKeyDown: (e) => {
      if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        openMenu();
      }
    },
  };

  return (
    <>
      {size === "md" ? (
        <button
          {...triggerProps}
          className={`input flex cursor-pointer items-center justify-between gap-2 !pr-3.5 text-left text-[14px] ${
            open ? "shadow-[0_0_0_3.5px_rgba(10,132,255,0.35)]" : ""
          } ${className}`}
        >
          <span className="min-w-0 flex-1 truncate">
            {selected ? (
              selected.triggerLabel ?? (
                <>
                  {selected.label}
                  {selected.sublabel && (
                    <span className="text-neutral-500"> · {selected.sublabel}</span>
                  )}
                </>
              )
            ) : (
              <span className="text-neutral-400">{placeholder}</span>
            )}
          </span>
          <IconChevronDown
            size={16}
            className={`shrink-0 text-neutral-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
      ) : (
        <button
          {...triggerProps}
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.08] py-1.5 pl-3 pr-2 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.14] ${className}`}
        >
          <span className="max-w-[160px] truncate">
            {selected ? (selected.triggerLabel ?? selected.label) : placeholder}
          </span>
          <IconChevronDown
            size={13}
            className={`shrink-0 text-neutral-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
      )}
      {open &&
        pos &&
        portalContainer &&
        createPortal(
          <div
            ref={panelRef}
            id={listboxId}
            role="listbox"
            data-popover-panel
            aria-label={ariaLabel}
            tabIndex={-1}
            onKeyDown={onListboxKeyDown}
            onFocusCapture={(event) => {
              popupHadFocus.current = true;
              if (event.target === event.currentTarget) setActiveValue(null);
            }}
            onBlurCapture={(event) => {
              // Removal/disable can emit a blur with no new target. Preserve
              // ownership until the layout effect repairs that lost focus.
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) popupHadFocus.current = false;
            }}
            className={POPOVER_PANEL_CLASS}
            style={popoverStyle(pos)}
          >
            {options.length === 0 && (
              <p className="px-3 py-6 text-center text-[12.5px] text-neutral-500">
                Nothing to choose from
              </p>
            )}
            {options.map((opt, i) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  id={`${listboxId}-option-${encodeURIComponent(opt.value)}`}
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled || undefined}
                  tabIndex={-1}
                  data-index={i}
                  disabled={opt.disabled}
                  onFocus={() => setActiveValue(opt.value)}
                  onClick={() => choose(opt)}
                  className={`mb-0.5 flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] transition-colors duration-100 last:mb-0 ${
                    i === activeIndex
                      ? "bg-white/[0.08] text-white"
                      : "text-neutral-300"
                  } ${opt.disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
                >
                  <span
                    className={`font-medium ${
                      preserveOptionLabels ? "shrink-0 whitespace-nowrap" : "min-w-0 flex-1 truncate"
                    }`}
                  >
                    {opt.label}
                  </span>
                  <span
                    className={`flex items-center gap-2 ${
                      preserveOptionLabels ? "min-w-0 flex-1 justify-end" : "shrink-0"
                    }`}
                  >
                    {opt.sublabel && (
                      <span
                        className={`mono min-w-0 text-[11.5px] text-neutral-500 ${
                          preserveOptionLabels ? "truncate" : "whitespace-nowrap"
                        }`}
                      >
                        {opt.sublabel}
                      </span>
                    )}
                    {isSelected && (
                      <IconCheck size={14} className="shrink-0 text-[#0A84FF]" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>,
          portalContainer,
        )}
    </>
  );
}

type DropdownTriggerProps = {
  ref: React.RefObject<HTMLButtonElement | null>;
  type: "button";
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  onClick: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
};

export function Dropdown({
  trigger,
  children,
  align = "right",
  className = "",
}: {
  trigger: (open: boolean, props: DropdownTriggerProps) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setRestoreFocus(true);
  }, []);
  const { panelRef, pos, portalContainer } = usePopover({
    open,
    onClose: close,
    anchorRef,
    align,
    matchAnchorWidth: false,
    minWidth: 220,
  });

  // Run before newly opened dialogs capture their return target. A menu action
  // can therefore close its portal and open a sheet without losing the trigger.
  useLayoutEffect(() => {
    if (!open && restoreFocus) {
      anchorRef.current?.focus({ preventScroll: true });
    }
  }, [open, restoreFocus]);

  const positionReady = pos !== null;
  useEffect(() => {
    if (!open || !positionReady) return;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus({
        preventScroll: true,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, positionReady, panelRef]);

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      setRestoreFocus(false);
      setOpen(false);
      if (focusAfterPopoverTrigger(anchorRef.current, event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
      } else anchorRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])',
      ) ?? [],
    ).filter((item) => item.offsetParent !== null);
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? (current - 1 + items.length) % items.length
            : (current + 1) % items.length;
    items[next]?.focus({ preventScroll: true });
  }

  const triggerProps: DropdownTriggerProps = {
    ref: anchorRef,
    type: "button",
    "aria-haspopup": "menu",
    "aria-expanded": open,
    onClick: () => {
      triggerHaptic("selection");
      setOpen((previous) => !previous);
    },
    onKeyDown: (event) => {
      if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        setOpen(true);
      }
    },
  };

  return (
    <div className={`inline-block max-w-full min-w-0 text-left ${className}`}>
      {trigger(open, triggerProps)}
      {open &&
        pos &&
        portalContainer &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            data-popover-panel
            onKeyDown={onMenuKeyDown}
            className={POPOVER_PANEL_CLASS}
            style={popoverStyle(pos)}
          >
            {children(close)}
          </div>,
          portalContainer,
        )}
    </div>
  );
}

type ClipboardFeedback = {
  scope: object | null;
  phase: "idle" | "pending" | "copied" | "cleared" | "error";
  action: "copy" | "clear";
  canClear: boolean;
};

const CLIPBOARD_FEEDBACK_MS = 2_000;

// Shared by the explicit copy button and address/hash display. Never read the
// clipboard or include a copied value in feedback. Scope tokens contain no data.
function useClipboardFeedback(value: string, sensitive = false) {
  const scope = React.useMemo(() => {
    // Changes invalidate the token; the token itself retains neither input.
    void value;
    void sensitive;
    return {};
  }, [value, sensitive]);
  const scopeRef = useRef<object | null>(null);
  const operationRef = useRef<symbol | null>(null);
  const timerRef = useRef<number | null>(null);
  const [feedback, setFeedback] = useState<ClipboardFeedback>({
    scope: null, phase: "idle", action: "copy", canClear: false,
  });

  useLayoutEffect(() => {
    scopeRef.current = scope;
    return () => {
      scopeRef.current = null;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [scope]);

  const current = feedback.scope === scope;
  // Clipboard writes cannot be aborted. Keep the control disabled until an
  // outstanding old-value write settles, so two physical writes cannot race.
  const pending = feedback.phase === "pending";
  const canClear = current && feedback.canClear;
  const copied = current && feedback.phase === "copied";
  const failed = current && feedback.phase === "error";
  const status = pending
    ? feedback.action === "clear" ? "Clearing clipboard…" : "Copying to clipboard…"
    : !current ? ""
    : feedback.phase === "copied" ? "Copied to clipboard."
    : feedback.phase === "cleared" ? "Clipboard cleared. Clipboard managers may retain earlier copies."
    : failed ? feedback.action === "clear"
      ? "Could not clear the clipboard. Try again."
      : "Could not copy. Try again or select and copy manually."
    : "";

  async function write(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (operationRef.current || scopeRef.current !== scope) return;
    // WebKit pointer activation otherwise leaves focus on body. Focus only the
    // directly activated control, never when a clipboard promise completes.
    event.currentTarget.focus({ preventScroll: true });
    const operation = Symbol();
    operationRef.current = operation;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const action = sensitive && canClear ? "clear" : "copy";
    setFeedback({ scope, phase: "pending", action, canClear });
    try {
      if (action === "clear") await navigator.clipboard.writeText("");
      else await navigator.clipboard.writeText(value);
      if (scopeRef.current !== scope) return;
      triggerHaptic("selection");
      setFeedback({ scope, phase: action === "clear" ? "cleared" : "copied", action,
        canClear: sensitive && action === "copy" });
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (scopeRef.current === scope) {
          setFeedback(previous => previous.scope === scope ? { ...previous, phase: "idle" } : previous);
        }
      }, CLIPBOARD_FEEDBACK_MS);
    } catch {
      if (scopeRef.current === scope) setFeedback({ scope, phase: "error", action, canClear });
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = null;
        // A replaced value must not inherit success or errors from the previous
        // copy. The old OS write may complete, but it cannot approve the new UI.
        if (scopeRef.current && scopeRef.current !== scope) {
          setFeedback({ scope: scopeRef.current, phase: "idle", action: "copy", canClear: false });
        }
      }
    }
  }

  return { pending, copied, canClear, failed, status, write };
}

function ClipboardStatus({ status, failed }: { status: string; failed: boolean }) {
  return <span role="status" aria-live="polite" aria-atomic="true"
    className={failed ? "mt-1 block text-[11.5px] text-red-300" : "sr-only"}>{status}</span>;
}

export function CopyButton({
  value,
  label,
  className,
  iconSize = 13,
  sensitive = false,
}: {
  value: string;
  label?: string;
  className?: string;
  iconSize?: number;
  sensitive?: boolean;
}) {
  const { pending, copied, canClear, failed, status, write } = useClipboardFeedback(value, sensitive);

  return (
    <>
    <button
      type="button"
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      onClick={(event) => void write(event)}
      className={`${className ?? "chip"} aria-disabled:cursor-wait aria-disabled:opacity-60`}
      aria-label={canClear ? "Clear copied secret from clipboard" : label ?? "Copy to clipboard"}
      title={sensitive ? "Clipboard managers may retain copied recovery material." : undefined}
    >
      {copied || canClear ? (
        <>
          <IconCheck size={iconSize} className="text-[#30D158]" />
          <span>{canClear ? "Clear clipboard" : "Copied"}</span>
        </>
      ) : (
        <>
          <IconCopy size={iconSize} />
          {label && <span>{label}</span>}
        </>
      )}
    </button>
    <ClipboardStatus status={status} failed={failed} />
    </>
  );
}

/**
 * Trezor-style hash/address display (mirrors hardware-wallet conventions):
 * values render in monospace split into 4-character verification chunks.
 * Default mode keeps everything on one line via a middle ellipsis
 * (head … tail, chunked); `full` shows every chunk, wrapping only at
 * chunk boundaries — never mid-group. Click anywhere to copy the full
 * value; the complete string is also exposed via the hover tooltip.
 */
export function HashValue({
  value,
  head = 8,
  tail = 8,
  full = false,
  className = "",
}: {
  value: string;
  head?: number;
  tail?: number;
  full?: boolean;
  className?: string;
}) {
  const { pending, copied, failed, status, write } = useClipboardFeedback(value);
  const truncate = !full && value.length > head + tail + 4;
  const chunkable = !/\s/.test(value);

  const chunks = (s: string, prefix: string) =>
    (s.match(/.{1,4}/g) ?? [s]).map((c, i) => <span key={`${prefix}${i}`}>{c}</span>);

  if (!chunkable) {
    return (
      <>
      <button
        type="button"
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        onClick={(event) => void write(event)}
        title={`${value}\nClick to copy`}
        className={`mono inline-block max-w-full cursor-pointer text-left transition-colors aria-disabled:cursor-wait aria-disabled:opacity-60 ${
          copied ? "!text-[#30D158]" : ""
        } ${className}`}
      >
        {value}
      </button>
      <ClipboardStatus status={status} failed={failed} />
      </>
    );
  }

  return (
    <>
    <button
      type="button"
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      onClick={(event) => void write(event)}
      data-mobile-truncate={truncate ? "true" : undefined}
      title={`${value}\nClick to copy`}
      className={`mono inline-flex max-w-full cursor-pointer items-baseline gap-x-[0.45em] gap-y-0.5 text-left transition-colors aria-disabled:cursor-wait aria-disabled:opacity-60 ${
        truncate ? "flex-nowrap whitespace-nowrap" : "flex-wrap"
      } ${copied ? "!text-[#30D158]" : ""} ${className}`}
    >
      {truncate ? (
        <>
          {chunks(value.slice(0, head), "h")}
          <span className={copied ? "font-bold" : "text-neutral-500"}>
            {copied ? "✓" : "…"}
          </span>
          {chunks(value.slice(-tail), "t")}
        </>
      ) : (
        chunks(value, "f")
      )}
    </button>
    <ClipboardStatus status={status} failed={failed} />
    </>
  );
}

export function NetworkBadge({ network }: { network: "testnet" | "mainnet" }) {
  const isTest = network === "testnet";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
        isTest
          ? "bg-[#FF9F0A]/15 text-[#FF9F0A] border border-[#FF9F0A]/30"
          : "bg-[#30D158]/15 text-[#30D158] border border-[#30D158]/30"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isTest ? "bg-[#FF9F0A]" : "bg-[#30D158]"
        }`}
      />
      {isTest ? "Testnet" : "Mainnet"}
    </span>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { label: string; value: T; disabled?: boolean }[];
  onChange: (val: T) => void;
  /** A bare role="group" has no accessible name without this label. */
  ariaLabel: string;
}) {
  // 5px of padding, not 4: it puts the control at 36px, the same height as
  // `.search-field`, so the two line up wherever they sit side by side.
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex items-center rounded-xl bg-white/[0.08] p-[5px] backdrop-blur-md"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            disabled={opt.disabled}
            onClick={() => {
              if (!active && !opt.disabled) {
                triggerHaptic("selection");
                onChange(opt.value);
              }
            }}
            className={`relative min-h-11 flex-1 rounded-[9px] py-1 text-center text-[12px] font-medium transition-[background-color,color,box-shadow] duration-150 sm:min-h-0 ${
              opt.disabled
                ? "cursor-not-allowed text-neutral-400"
                : active
                ? "bg-white/[0.18] text-white shadow-sm font-semibold"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  activationMode = "automatic",
  children,
  panelBusy = false,
  className = "",
  tabListClassName = "",
  panelClassName = "",
}: {
  value: T;
  options: { label: string; value: T; disabled?: boolean }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Async/private panels require explicit Enter/Space activation after arrow navigation. */
  activationMode?: "automatic" | "manual";
  children: React.ReactNode;
  panelBusy?: boolean;
  className?: string;
  tabListClassName?: string;
  panelClassName?: string;
}) {
  const baseId = React.useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusedValue, setFocusedValue] = useState(value);
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const activeValue = options[activeIndex]?.value ?? value;
  const focusedOption = options.find(option => option.value === focusedValue && !option.disabled);
  const tabStopValue = activationMode === "manual" ? focusedOption?.value ?? activeValue : activeValue;

  const activate = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    tabRefs.current[index]?.focus({ preventScroll: true });
    if (option.value !== value) {
      triggerHaptic("selection");
      onChange(option.value);
    }
  };

  const move = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const requested = tabIndexAfterKey(currentIndex, options.length, event.key);
    if (requested === null) return;
    event.preventDefault();

    const direction = event.key === "ArrowLeft" || event.key === "End" ? -1 : 1;
    let candidate = requested;
    for (let visited = 0; visited < options.length; visited += 1) {
      if (!options[candidate]?.disabled) {
        if (activationMode === "manual") tabRefs.current[candidate]?.focus({ preventScroll: true });
        else activate(candidate);
        return;
      }
      candidate = (candidate + direction + options.length) % options.length;
    }
  };

  return (
    <div data-tabs-root className={className}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        aria-orientation="horizontal"
        className={`flex items-center rounded-xl bg-white/[0.08] p-[5px] backdrop-blur-md ${tabListClassName}`}
      >
        {options.map((option, index) => {
          const active = option.value === value;
          const tabId = `${baseId}-tab-${option.value}`;
          const panelId = `${baseId}-panel-${option.value}`;
          return (
            <button
              key={option.value}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={option.value === tabStopValue ? 0 : -1}
              disabled={option.disabled}
              data-tab-value={option.value}
              onKeyDown={(event) => move(event, index)}
              onFocus={() => setFocusedValue(option.value)}
              onClick={() => activate(index)}
              className={`relative min-h-11 flex-1 rounded-[9px] py-1 text-center text-[12px] font-medium transition-[background-color,color,box-shadow] duration-150 sm:min-h-0 ${
                option.disabled
                  ? "cursor-not-allowed text-neutral-400"
                  : active
                    ? "bg-white/[0.18] font-semibold text-white shadow-sm"
                    : "text-neutral-400 hover:text-white"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div
        id={`${baseId}-panel-${activeValue}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${activeValue}`}
        aria-busy={panelBusy || undefined}
        tabIndex={0}
        data-tab-panel={activeValue}
        className={`outline-none ${panelClassName}`}
      >
        {children}
      </div>
    </div>
  );
}

export function LoadingRegion({
  label,
  className = "min-h-56",
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 p-6 text-center ${className}`}
    >
      <Spinner />
      <span className="text-[12px] text-neutral-400">{label}…</span>
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="spinner inline-block align-middle"
      style={{ width: size, height: size }}
    />
  );
}

export function Button({
  children,
  className = "",
  variant = "primary",
  loading = false,
  loadingLabel = "Working",
  disabled = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
  loadingLabel?: string;
}) {
  const vClass =
    variant === "primary"
      ? "btn-primary"
      : variant === "danger"
        ? "bg-[#D70015] text-white hover:bg-[#B60012] shadow-sm"
        : variant === "secondary"
          ? "bg-white/[0.08] text-white hover:bg-white/[0.14] border border-white/10"
          : "btn-ghost";

  return (
    <>
      <button
        {...props}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        data-loading={loading || undefined}
        className={`btn relative ${vClass} ${className}`}
      >
        <span
          className={`inline-flex min-w-0 w-full items-center justify-center gap-2 whitespace-normal break-words text-center leading-tight ${loading ? "opacity-0" : ""}`}
        >
          {children}
        </span>
        {loading && (
          <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </span>
        )}
      </button>
      {loading && (
        <span role="status" aria-label={loadingLabel} aria-live="polite" className="sr-only">
          {loadingLabel}
        </span>
      )}
    </>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const generatedId = React.useId();
  const hintId = `${generatedId}-hint`;
  const errorId = `${generatedId}-error`;
  const controlId = React.isValidElement<{ id?: string }>(children)
    ? children.props.id ?? generatedId
    : generatedId;
  const control = React.isValidElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }>(children)
    ? React.cloneElement(children, (() => {
        const describedBy = [
          children.props["aria-describedby"],
          hint ? hintId : null,
          error ? errorId : null,
        ].filter(Boolean).join(" ") || undefined;
        return {
          id: controlId,
          "aria-describedby": describedBy,
          ...(error ? { "aria-invalid": true } : {}),
        };
      })())
    : children;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={controlId} className="field-label !pb-0">{label}</label>
        {hint && <span id={hintId} className="text-[11px] text-neutral-400">{hint}</span>}
      </div>
      {control}
      {error && <p id={errorId} role="alert" className="text-[11.5px] text-[#FF453A]">{error}</p>}
    </div>
  );
}

export function ErrorText({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl border border-[#FF453A]/30 bg-[#FF453A]/10 p-3 text-[12px] text-[#FF453A] leading-relaxed">
      {message}
    </div>
  );
}

export function Notice({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "warn" | "pos";
}) {
  const styles =
    tone === "pos"
      ? "border-[#30D158]/30 bg-[#30D158]/10 text-neutral-200"
      : tone === "warn"
        ? "border-[#FF9F0A]/30 bg-[#FF9F0A]/10 text-neutral-200"
        : "border-white/10 bg-white/[0.04] text-neutral-300";

  return (
    <div className={`rounded-2xl border p-4 text-[13px] leading-relaxed ${styles}`}>
      {children}
    </div>
  );
}

export function Toggle({
  checked,
  on,
  onChange,
  disabled = false,
  label,
}: {
  checked?: boolean;
  on?: boolean;
  onChange: (c?: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  const isChecked = checked ?? on ?? false;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      disabled={disabled}
      onClick={() => {
        triggerHaptic("selection");
        onChange(!isChecked);
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A84FF] ${
        isChecked ? "bg-[#30D158]" : "bg-neutral-700"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span className="sr-only">{label}</span>
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ease-in-out ${
          isChecked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function Avatar({
  seed,
  size = 32,
  label,
}: {
  seed: string;
  size?: number;
  /** Overrides the displayed initial (defaults to first char of seed). */
  label?: string;
}) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue1 = hash % 360;
  const hue2 = (hash + 120) % 360;

  return (
    <div
      className="shrink-0 rounded-full flex items-center justify-center font-bold text-white shadow-inner"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue1}, 70%, 50%), hsl(${hue2}, 70%, 40%))`,
        fontSize: size * 0.4,
      }}
    >
      {label ?? seed.slice(0, 1)}
    </div>
  );
}

export function QrScannerBox({
  onScan,
  onClose,
}: {
  onScan: (val: string) => void;
  onClose?: () => void;
}) {
  const [inputVal, setInputVal] = useState("");

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
      <div className="flex items-center justify-between text-[12px] font-semibold text-white">
        <span>Enter QR Payload</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scanner"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-neutral-400 transition-colors hover:bg-white/15 hover:text-white"
        >
          <IconClose size={11} />
        </button>
      </div>
      <div className="h-40 rounded-xl bg-black/50 border border-dashed border-white/20 flex flex-col items-center justify-center p-4 text-center">
        <p className="text-[12px] text-neutral-400">
          Paste the address or SEP-7 payload read by your device&apos;s QR scanner.
        </p>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Paste scanned address or URI..."
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          className="input mono flex-1 !h-11 text-base md:!h-8 sm:text-[12px]"
        />
        <Button
          variant="secondary"
          className="!h-11 !px-3 text-[12px] md:!h-8"
          onClick={() => {
            if (inputVal.trim()) {
              triggerHaptic("success");
              onScan(inputVal.trim());
            }
          }}
        >
          Submit
        </Button>
      </div>
    </div>
  );
}
