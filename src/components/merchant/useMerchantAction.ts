"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useMerchantRecords } from "@/hooks/useMerchant";
import { triggerHaptic } from "@/lib/haptics";
import { useToast } from "../Toast";

/** Local feedback belongs to this opening and merchant session, not the store object. */
export function useMerchantAction(scope?: object) {
  const { captureActionGuard } = useMerchantRecords();
  const { toast } = useToast();
  const owner = useRef<object | null>(null);
  const operation = useRef<object | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ scope?: object; message: string; current(): boolean } | null>(null);

  useLayoutEffect(() => {
    owner.current = {};
    return () => { owner.current = null; };
  }, [scope]);

  async function run(action: () => Promise<unknown>, success: string, error: string, onSuccess?: (isCurrent: () => boolean) => void) {
    if (operation.current || !owner.current) return;
    const opening = owner.current;
    let access: ReturnType<typeof captureActionGuard>;
    // Revocation can precede React's unmount. Never reject a void UI handler.
    try { access = captureActionGuard(); } catch { return; }
    const token = {};
    operation.current = token;
    const current = () => owner.current === opening && access.isCurrent();
    setPending(true);
    setFailure(null);
    try {
      await action();
      if (!current()) return;
      toast(success, "success");
      onSuccess?.(current);
    } catch {
      if (!current()) return;
      triggerHaptic("error");
      setFailure({ scope, message: error, current });
    } finally {
      if (operation.current === token) {
        operation.current = null;
        // Release only this physical operation's lock, including a clipboard
        // write whose URI changed. No newer feedback is changed by cleanup.
        if (owner.current) setPending(false);
      }
    }
  }

  return { pending, error: failure?.scope === scope && failure?.current() ? failure.message : "", run };
}
