'use client';

import { useEffect, useRef } from 'react';

/**
 * Reports a piece of embedded state (busy, dirty, the stage header) to the
 * dialog that owns the shell. The callback is read through a ref so an owner
 * may pass an inline function without re-triggering the report on every
 * render; unmounting reports the idle value so the shell never stays blocked
 * or guarded by content that has left.
 */
export function useReportToOwner<T>(
  report: ((value: T) => void) | undefined,
  value: T,
  idle: T,
): void {
  const reportRef = useRef(report);
  useEffect(() => {
    reportRef.current = report;
  }, [report]);
  useEffect(() => {
    reportRef.current?.(value);
  }, [value]);
  useEffect(() => () => reportRef.current?.(idle), [idle]);
}

/** The stage-aware header an embedded private flow asks its owning shell to show. */
export interface PrivateFlowHeader {
  title: string;
  subtitle?: string;
  onBack?: () => void;
}

/** `null` restores the owner's default header (the form stage). */
export type PrivateFlowHeaderChange = (header: PrivateFlowHeader | null) => void;
