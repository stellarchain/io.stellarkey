/** Keep preference changes inside the same exclusive runtime lane as proofs.
 * The caller also checks availability inside its mutex, before durable writes. */
export async function changePrivateOutgoingHistory<T>(input: {
  busy: { current: boolean };
  access(): { mounted: boolean; leader: boolean; unlocked: boolean; authenticatedCurrent: boolean; contextCurrent: boolean };
  change(check: () => void): Promise<T>;
}): Promise<T> {
  const check = () => {
    const access = input.access();
    if (!access.mounted || !access.leader || !access.unlocked || !access.authenticatedCurrent || !access.contextCurrent) throw new Error('Outgoing-history settings are unavailable after the wallet context changed. Unlock and sync in this tab.');
  };
  check();
  if (input.busy.current) throw new Error('Finish the current Private Balance action before changing outgoing history.');
  input.busy.current = true;
  try {
    const result = await input.change(check);
    check();
    return result;
  } finally { input.busy.current = false; }
}
