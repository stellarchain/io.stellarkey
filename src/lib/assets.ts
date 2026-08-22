export interface KnownAsset {
  code: string;
  name: string;
  color: string;
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
    description: "Circle US Dollar stablecoin pegged 1:1 to USD",
    anchorDomain: "circle.com",
    mainnetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    testnetIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  },
  {
    code: "EURC",
    name: "Euro Coin",
    color: "#1E52B6",
    description: "Circle Euro stablecoin backed 100% by euros",
    anchorDomain: "circle.com",
    mainnetIssuer: "GDHU6WRG4IEQXM5OZBCQKWLFLNQ4UXGVE6L45RFYCR27AIPKMGNCBBB6",
    testnetIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  },
  {
    code: "AQUA",
    name: "Aquarius",
    color: "#3B82F6",
    description: "Liquidity rewards & governance token for Stellar DEX",
    anchorDomain: "aqua.network",
    mainnetIssuer: "GBNZILSTVQZ4ROOF2MDRQKDT6YTOEG7PLGAPNOCCK6LTXD5KPYTQJNDQ",
  },
  {
    code: "BTC",
    name: "Bitcoin",
    color: "#F7931A",
    description: "Bitcoin anchored on Stellar by Ultrastellar",
    anchorDomain: "ultrastellar.com",
    mainnetIssuer: "GDPKQ2COJNMYWFK6NZTGMCG5IDCNOJR75BP4KVNZW2PP54RRKLGBAAQF",
  },
  {
    code: "ETH",
    name: "Ethereum",
    color: "#627EEA",
    description: "Ethereum anchored on Stellar by Ultrastellar",
    anchorDomain: "ultrastellar.com",
    mainnetIssuer: "GBETHKBL5TCUTQ3VPVUQH2WQIINWOQST4STPVLQ23MGNK7FCS3R7SMR6",
  },
  {
    code: "yXLM",
    name: "Yield XLM",
    color: "#00B8D9",
    description: "Yield-generating interest-bearing XLM by Ultrastellar",
    anchorDomain: "ultrastellar.com",
    mainnetIssuer: "GARDNDAXRNBT6GUW3YKEBNXZWFLPTLSDXWK4EU6INCPSEDC4Y76EBIMA",
  },
  {
    code: "ARST",
    name: "Argentine Peso",
    color: "#8B5CF6",
    description: "Argentine Peso stablecoin anchored on Stellar",
    anchorDomain: "anclap.com",
    mainnetIssuer: "GCSAZVWXZKWS4XS222MZZYA5Q24GHP44P2TCMA2LM5AHUGLD72CSQC46",
  },
];

const DIRECTORY: Record<string, KnownAsset> = Object.fromEntries(
  POPULAR_ASSETS.map((a) => [a.code.toUpperCase(), a]),
);

export function lookupKnownAsset(code: string): KnownAsset | null {
  return DIRECTORY[code.toUpperCase()] ?? null;
}
