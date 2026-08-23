export interface PayUriPayload {
  destination?: string;
  amount?: string;
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
  memoType?: "text" | "id" | "hash" | "return";
  unsupportedMemoType?: string;
  msg?: string;
  networkPassphrase?: string;
  callback?: string;
  originDomain?: string;
  signature?: string;
}

function parseMemoType(value: string | undefined): PayUriPayload["memoType"] {
  switch (value?.toUpperCase()) {
    case "MEMO_TEXT": return "text";
    case "MEMO_ID": return "id";
    case "MEMO_HASH": return "hash";
    case "MEMO_RETURN": return "return";
    default: return undefined;
  }
}

function sep7MemoType(value: PayUriPayload["memoType"]): string | undefined {
  return value ? `MEMO_${value.toUpperCase()}` : undefined;
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
    const payload: PayUriPayload = {};
    const rawMemoType = get("memo_type");
    const memoType = parseMemoType(rawMemoType);
    const fields: Array<[keyof PayUriPayload, string | undefined]> = [
      ["destination", get("destination") ?? get("dest")],
      ["amount", get("amount")],
      ["assetCode", get("asset_code")],
      ["assetIssuer", get("asset_issuer")],
      ["memo", get("memo")],
      ["memoType", memoType],
      ["unsupportedMemoType", rawMemoType && !memoType ? rawMemoType : undefined],
      ["msg", get("msg")],
      ["networkPassphrase", get("network_passphrase")],
      ["callback", get("callback")],
      ["originDomain", get("origin_domain")],
      ["signature", get("signature")],
    ];
    for (const [key, value] of fields) {
      if (value !== undefined) Object.assign(payload, { [key]: value });
    }
    return payload;
  } catch {
    return null;
  }
}

export function buildSep7PayUri(payload: PayUriPayload): string {
  if (payload.unsupportedMemoType) {
    throw new Error(`SEP-7 memo type ${payload.unsupportedMemoType} is not supported.`);
  }
  const params = new URLSearchParams();
  if (payload.destination) params.set("destination", payload.destination);
  if (payload.amount) params.set("amount", payload.amount);
  if (payload.assetCode) params.set("asset_code", payload.assetCode);
  if (payload.assetIssuer) params.set("asset_issuer", payload.assetIssuer);
  if (payload.memo) params.set("memo", payload.memo);
  const memoType = sep7MemoType(payload.memoType);
  if (memoType) params.set("memo_type", memoType);
  if (payload.msg) params.set("msg", payload.msg);
  if (payload.networkPassphrase) params.set("network_passphrase", payload.networkPassphrase);
  if (payload.callback) params.set("callback", payload.callback);
  if (payload.originDomain) params.set("origin_domain", payload.originDomain);
  if (payload.signature) params.set("signature", payload.signature);

  return `web+stellar:pay?${params.toString()}`;
}

/**
 * This wallet supports local, unsigned `pay` requests only. Requests that
 * require SEP-7 origin verification or callback submission must not be
 * treated as ordinary payment prefills until those protocols are implemented.
 */
export function validateSep7PayRequest(
  payload: PayUriPayload,
  expectedNetworkPassphrase?: string,
): string | null {
  if (payload.unsupportedMemoType) {
    return `SEP-7 memo type ${payload.unsupportedMemoType} is not supported.`;
  }
  if (payload.signature || payload.originDomain) {
    return "Signed SEP-7 requests are not supported because this wallet cannot verify their origin yet.";
  }
  if (payload.callback) {
    return "SEP-7 callback requests are not supported by this wallet.";
  }
  if (
    expectedNetworkPassphrase &&
    payload.networkPassphrase &&
    payload.networkPassphrase !== expectedNetworkPassphrase
  ) {
    return "This payment request targets a different Stellar network.";
  }
  return null;
}
