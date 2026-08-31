"use client";

import { useState } from "react";
import { useWalletSecurity } from "@/hooks/useWallet";
import type { SigningAuthorizationRequest } from "@/lib/signing-authorization";
import { triggerHaptic } from "@/lib/haptics";
import { Button, ErrorText, Field, Modal, ModalHeader, Notice } from "./ui";

export function SigningPasswordPrompt() {
  const security = useWalletSecurity();
  if (!security.signingAuthorizationRequest) return null;

  return (
    <SigningPasswordDialog
      request={security.signingAuthorizationRequest}
      approveSigningAuthorization={security.approveSigningAuthorization}
      continueSigningAuthorization={security.continueSigningAuthorization}
      cancelSigningAuthorization={security.cancelSigningAuthorization}
    />
  );
}

function SigningPasswordDialog({
  request,
  approveSigningAuthorization,
  continueSigningAuthorization,
  cancelSigningAuthorization,
}: {
  request: SigningAuthorizationRequest;
  approveSigningAuthorization: (password: string) => Promise<"approved" | "continue">;
  continueSigningAuthorization: () => void;
  cancelSigningAuthorization: (message?: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passwordVerified, setPasswordVerified] = useState(false);

  const cancel = () => {
    if (busy) return;
    setPassword("");
    setError(null);
    cancelSigningAuthorization();
  };

  const approve = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await approveSigningAuthorization(password);
      setPassword("");
      triggerHaptic("success");
      if (result === "continue") {
        setPasswordVerified(true);
        setBusy(false);
      }
    } catch (cause) {
      triggerHaptic("error");
      setError(cause instanceof Error ? cause.message : "Password verification failed.");
      setBusy(false);
    }
  };

  const continueToHardware = () => {
    try {
      continueSigningAuthorization();
      triggerHaptic("selection");
    } catch (cause) {
      triggerHaptic("error");
      setError(cause instanceof Error ? cause.message : "Could not continue to your Trezor.");
    }
  };

  return (
    <Modal
      open
      onClose={cancel}
      dismissable={!busy}
    >
      <ModalHeader
        title="Confirm transaction"
        subtitle={request.label}
        onClose={busy ? undefined : cancel}
      />
      <form
        className="space-y-4 p-4 sm:p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void approve();
        }}
      >
        {passwordVerified ? (
          <>
            <Notice tone="pos">
              Password confirmed. Continue from this button so your browser can open Trezor’s
              approval window securely.
            </Notice>
            <div className="grid grid-cols-2 gap-3">
              <Button type="button" variant="ghost" onClick={cancel}>
                Cancel
              </Button>
              <Button type="button" onClick={continueToHardware}>
                Continue on Trezor
              </Button>
            </div>
          </>
        ) : (
          <>
            <Notice>
              Enter your wallet password before StellarKey signs this transaction. The password is
              verified locally and is not stored after approval.
            </Notice>
            <Field label="Wallet Password" hint="Required for this signature only">
              <input
                className="input text-base sm:text-[14px]"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                disabled={busy}
                autoFocus
              />
            </Field>
            <ErrorText message={error ?? ""} />
            <div className="grid grid-cols-2 gap-3">
              <Button type="button" variant="ghost" disabled={busy} onClick={cancel}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={!password || busy}>
                Authorize
              </Button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
