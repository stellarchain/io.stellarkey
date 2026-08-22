export interface PayUriPayload {
  destination?: string;
  amount?: string;
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
  msg?: string;
}

export function parseSep7PayUri(raw: string): PayUriPayload | null {
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith("web+stellar:pay")) return null;
  try {
    const queryPart = trimmed.slice(trimmed.indexOf("?") + 1);
    const params = new URLSearchParams(queryPart);
    const get = (k: string) => {
      const v = params.get(k);
      return v && v.length > 0 ? v : undefined;
    };
    return {
      destination: get("dest"),
      amount: get("amount"),
      assetCode: get("asset_code"),
      assetIssuer: get("asset_issuer"),
      memo: get("memo"),
      msg: get("msg"),
    };
  } catch {
    return null;
  }
}

export function buildSep7PayUri(payload: PayUriPayload): string {
  const params = new URLSearchParams();
  if (payload.destination) params.set("dest", payload.destination);
  if (payload.amount) params.set("amount", payload.amount);
  if (payload.assetCode) params.set("asset_code", payload.assetCode);
  if (payload.assetIssuer) params.set("asset_issuer", payload.assetIssuer);
  if (payload.memo) params.set("memo", payload.memo);
  if (payload.msg) params.set("msg", payload.msg);

  return `web+stellar:pay?${params.toString()}`;
}
