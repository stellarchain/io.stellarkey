'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { privateAddressFingerprint, privateReceivePayload, type PrivateAddressPrefix } from '../runtime/receive';

/** Request continuity metadata, never the address, crosses the lazy boundary. */
export interface PrivateReceiveRequest {
  scope: string;
  reused: boolean;
  fingerprint: string;
}

function matchesSavedAddress(address: string, request: PrivateReceiveRequest): boolean {
  try { return privateAddressFingerprint(address) === request.fingerprint; }
  catch { return false; }
}

type RequestState = {
  scope: string;
  status: 'creating' | 'ready' | 'failed';
  address: string | null;
  reused: boolean;
  error: unknown;
};

export function usePrivateReceiveRequest({
  request, onRequestChange, scope, enabled, canCreate, savedAddress, prefix, issue,
}: {
  request?: PrivateReceiveRequest | null;
  onRequestChange?(request: PrivateReceiveRequest): void;
  scope: string;
  enabled: boolean;
  canCreate: boolean;
  savedAddress: string | null;
  prefix: PrivateAddressPrefix;
  issue(): Promise<string>;
}) {
  const [state, setState] = useState<RequestState | null>(null);
  const [issued, setIssued] = useState<PrivateReceiveRequest | null>(null);
  const retained = request ?? issued;
  // Re-entering a tab in the same opening adopts the already issued durable
  // identity. The parent retains only issuance metadata, never the address.
  if (!enabled && state !== null) {
    setState(null);
  } else if (enabled && state?.scope !== scope) {
    if (retained?.scope === scope && savedAddress) {
      setState(matchesSavedAddress(savedAddress, retained)
        ? { scope, status: 'ready', address: savedAddress, reused: retained.reused, error: null }
        : { scope, status: 'failed', address: null, reused: false,
          error: new Error('The saved receive address changed. Create a new request or explicitly reuse the saved address.') });
    } else if (state !== null) setState(null);
  }
  const owner = useRef<string | null>(null);
  const operation = useRef<{ scope: string } | null>(null);
  useLayoutEffect(() => {
    owner.current = enabled ? scope : null;
    return () => { owner.current = null; };
  }, [enabled, scope]);

  const create = useCallback(() => {
    if (!enabled || !canCreate || owner.current !== scope || operation.current?.scope === scope) return;
    const token = { scope };
    operation.current = token;
    const current = () => owner.current === scope && operation.current === token;
    setState({ scope, status: 'creating', address: null, reused: false, error: null });
    void Promise.resolve().then(() => {
      if (!current()) throw new DOMException('Receive request cancelled.', 'AbortError');
      return issue();
    }).then(address => {
      if (!current()) return;
      const payload = privateReceivePayload(address, prefix);
      // The provider resolves only after durable encrypted issuance. Keep the
      // displayed request stable even if the runtime later rotates elsewhere.
      const identity = { scope, reused: false, fingerprint: privateAddressFingerprint(payload) };
      onRequestChange?.(identity);
      setIssued(identity);
      setState({ scope, status: 'ready', address: payload, reused: false, error: null });
    }).catch(error => {
      if (current()) setState({ scope, status: 'failed', address: null, reused: false, error });
    }).finally(() => {
      if (operation.current === token) operation.current = null;
    });
  }, [canCreate, enabled, issue, onRequestChange, prefix, scope]);

  useEffect(() => {
    if (!enabled || state?.scope === scope) return;
    // A replaced scope revokes publication of the old operation; its already
    // authorized durable issuance is not undone.
    create();
  }, [create, enabled, scope, state?.scope]);

  const reuse = () => {
    if (!enabled || !savedAddress || operation.current?.scope === scope || owner.current !== scope) return;
    try {
      const payload = privateReceivePayload(savedAddress, prefix);
      const identity = { scope, reused: true, fingerprint: privateAddressFingerprint(payload) };
      onRequestChange?.(identity);
      setIssued(identity);
      setState({ scope, status: 'ready', address: payload, reused: true, error: null });
    } catch (error) {
      setState({ scope, status: 'failed', address: null, reused: false, error });
    }
  };
  const current = enabled && state?.scope === scope ? state : null;
  return {
    address: savedAddress ? current?.address ?? null : null,
    creating: current?.status === 'creating',
    failed: current?.status === 'failed',
    reused: current?.reused ?? false,
    error: current?.error ?? null,
    create,
    reuse,
  };
}
