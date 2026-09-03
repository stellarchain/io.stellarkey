export type NetworkKey = "testnet" | "mainnet";

export interface NetworkConfig {
  id: NetworkKey;
  label: string;
  horizonUrl: string;
  rpcUrl: string | null;
  networkPassphrase: string;
  friendbotUrl: string | null;
  explorerTxUrl: (hash: string) => string;
  explorerAccountUrl: (pk: string) => string;
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  testnet: {
    id: "testnet",
    label: "Testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    friendbotUrl: "https://friendbot.stellar.org",
    explorerTxUrl: (hash) => `https://testnet.stellarchain.io/tx/${hash}`,
    explorerAccountUrl: (pk) => `https://testnet.stellarchain.io/address/${pk}`,
  },
  mainnet: {
    id: "mainnet",
    label: "Mainnet",
    horizonUrl: "https://horizon.stellar.org",
    rpcUrl: null,
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    friendbotUrl: null,
    explorerTxUrl: (hash) => `https://stellarchain.io/tx/${hash}`,
    explorerAccountUrl: (pk) => `https://stellarchain.io/address/${pk}`,
  },
};

/**
 * Public/private boundary actions are ordinary Stellar transactions. Return
 * their canonical hash for explorer links, while keeping private transfers
 * and synthetic restored-history identifiers out of public explorer URLs.
 */
export function privateBalanceExplorerTxHash(
  actionKind: "deposit" | "transfer" | "withdraw",
  transactionHash: string | null | undefined,
): string | null {
  if (actionKind === "transfer" || !transactionHash) return null;
  return /^[0-9a-f]{64}$/i.test(transactionHash) ? transactionHash : null;
}

export const BASE_RESERVE_XLM = 0.5;
