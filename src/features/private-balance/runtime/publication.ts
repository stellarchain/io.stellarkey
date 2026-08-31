export type PrivateRuntimePublicationAuthority = 'render' | 'durable';

export interface PublishedPrivateRuntime<T> {
  key: string;
  value: T;
}

/**
 * Reconciles the dynamically rendered runtime with durable local state.
 *
 * Render publication is intentionally advisory: concurrent React commits can
 * publish an older pre-setup snapshot after encrypted state has already been
 * written. Only an explicit durable event may revoke a configured runtime.
 */
export function mergePrivateRuntimePublication<T extends { configured: boolean }>(
  current: PublishedPrivateRuntime<T> | null,
  key: string,
  value: T,
  authority: PrivateRuntimePublicationAuthority,
): PublishedPrivateRuntime<T> | null {
  if (authority === 'durable' && current?.key !== key) return current;
  if (
    authority === 'render' &&
    current?.key === key &&
    current.value.configured &&
    !value.configured
  ) {
    return current;
  }
  if (current?.key === key && current.value === value) return current;
  return { key, value };
}
