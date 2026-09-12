/** Async completion belongs to one operation, never to a replacement screen. */
export async function completePrivateActionOperation<Result>(input: {
  controller: AbortController;
  current: { current: AbortController | null };
  run(): Promise<Result>;
  success(result: Result): void;
  failure(error: unknown): void;
  finish(): void;
}): Promise<void> {
  const ownsUi = () => input.current.current === input.controller;
  try {
    const result = await input.run();
    if (ownsUi() && !input.controller.signal.aborted) input.success(result);
  } catch (error) {
    if (ownsUi() && !input.controller.signal.aborted) input.failure(error);
  } finally {
    if (ownsUi()) {
      input.current.current = null;
      input.finish();
    }
  }
}
