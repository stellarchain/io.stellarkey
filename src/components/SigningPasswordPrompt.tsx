"use client";

import { useRef, useState } from "react";
import { useWalletSecurity } from "@/hooks/useWallet";
import type { SigningAuthorizationRequest } from "@/lib/signing-authorization";
import { triggerHaptic } from "@/lib/haptics";
import {
  Button,
  ErrorText,
  Field,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Notice,
} from "./ui";

export function SigningPasswordPrompt() {
  const security = useWalletSecurity();

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
  request: SigningAuthorizationRequest | null;
  approveSigningAuthorization: (password: string) => Promise<"approved" | "continue">;
  continueSigningAuthorization: () => void;
  cancelSigningAuthorization: (message?: string) => void;
}) {
  const open = request !== null;
  const sensitiveSetting = request?.purpose === "sensitive-setting";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passwordVerified, setPasswordVerified] = useState(false);
  const [prevRequest, setPrevRequest] = useState(request);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Every request starts from an empty prompt, and nothing typed survives its close.
  if (request !== prevRequest) {
    setPrevRequest(request);
    setPassword("");
    setError(null);
    setPasswordVerified(false);
  }

  const cancel = () => {
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
      if (result === "continue") setPasswordVerified(true);
    } catch (cause) {
      triggerHaptic("error");
      setError(cause instanceof Error ? cause.message : "Password verification failed.");
    } finally {
      setBusy(false);
    }
  };

  const continueToHardware = () => {
    try {
      continueSigningAuthorization();
    } catch (cause) {
      triggerHaptic("error");
      setError(cause instanceof Error ? cause.message : "Could not continue to your Trezor.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={cancel}
      busy={busy}
      busyReason="Wait for the password check to finish before closing."
      initialFocus={passwordRef}
    >
      {request && (
        <>
          <ModalHeader
            title={sensitiveSetting ? "Confirm security change" : "Confirm transaction"}
            subtitle={request.label}
            onClose={cancel}
          />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void approve();
            }}
          >
            <ModalBody>
              {passwordVerified ? (
                <>
                  <Notice tone="pos">
                    Password confirmed. Continue from this button so your browser can open Trezor’s
                    approval window securely.
                  </Notice>
                  <ModalFooter
                    secondary={
                      <Button type="button" variant="ghost" onClick={cancel}>
                        Cancel
                      </Button>
                    }
                    primary={
                      <Button type="button" onClick={continueToHardware}>
                        Continue on Trezor
                      </Button>
                    }
                  />
                </>
              ) : (
                <>
                  <Notice>
                    {sensitiveSetting
                      ? "Enter your wallet password to approve this sensitive change. The password is verified locally and is not stored after approval."
                      : "Enter your wallet password before StellarKey signs this transaction. The password is verified locally and is not stored after approval."}
                  </Notice>
                  <Field
                    label="Wallet Password"
                    hint={sensitiveSetting ? "Required for this change only" : "Required for this signature only"}
                  >
                    <input
                      ref={passwordRef}
                      className="input text-base sm:text-[14px]"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter password"
                      enterKeyHint="done"
                      disabled={busy}
                    />
                  </Field>
                  <ErrorText message={error ?? ""} />
                  <ModalFooter
                    secondary={
                      <Button type="button" variant="ghost" disabled={busy} onClick={cancel}>
                        Cancel
                      </Button>
                    }
                    primary={
                      <Button type="submit" loading={busy} loadingLabel="Verifying password" disabled={!password}>
                        Authorize
                      </Button>
                    }
                  />
                </>
              )}
            </ModalBody>
          </form>
        </>
      )}
    </Modal>
  );
}
