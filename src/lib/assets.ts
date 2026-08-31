export interface KnownAsset {
  code: string;
  name: string;
  color: string;
  iconUrl?: string;
  mainnetIssuer?: string;
  testnetIssuer?: string;
  description?: string;
  anchorDomain?: string;
}

export const POPULAR_ASSETS: KnownAsset[] = [
  {
    code: "USDC",
    name: "USD Coin",
    color: "#2775CA",
    iconUrl: "/assets/usdc.svg",
    description: "Circle US Dollar stablecoin pegged 1:1 to USD",
    anchorDomain: "circle.com",
    mainnetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    testnetIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  },
  {
    code: "EURC",
    name: "Euro Coin",
    color: "#1E52B6",
    iconUrl: "/assets/eurc.svg",
    description: "Circle Euro stablecoin backed 100% by euros",
    anchorDomain: "circle.com",
    testnetIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  },
  {
    code: "USDT0",
    name: "USDT0",
    color: "#00805E",
    iconUrl: "/assets/usdt0.svg",
    description: "Tether's USDT, built to move seamlessly across supported networks",
    anchorDomain: "usdt0.to",
    mainnetIssuer: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
  },
];

type AssetNetwork = "mainnet" | "testnet";

export function knownAssetIssuer(asset: KnownAsset, network: AssetNetwork): string | null {
  return (network === "mainnet" ? asset.mainnetIssuer : asset.testnetIssuer) ?? null;
}

export function knownAssetsForNetwork(network: AssetNetwork): KnownAsset[] {
  return POPULAR_ASSETS.filter((asset) => knownAssetIssuer(asset, network) !== null);
}

function directoryKey(network: AssetNetwork, code: string, issuer: string): string {
  return `${network}:${code.trim().toUpperCase()}:${issuer.trim()}`;
}

const DIRECTORY = new Map<string, KnownAsset>();
for (const asset of POPULAR_ASSETS) {
  if (asset.mainnetIssuer) {
    DIRECTORY.set(directoryKey("mainnet", asset.code, asset.mainnetIssuer), asset);
  }
  if (asset.testnetIssuer) {
    DIRECTORY.set(directoryKey("testnet", asset.code, asset.testnetIssuer), asset);
  }
}

export function lookupKnownAsset(
  code: string,
  issuer?: string | null,
  network: AssetNetwork = "mainnet",
): KnownAsset | null {
  if (!issuer) return null;
  return DIRECTORY.get(directoryKey(network, code, issuer)) ?? null;
}
