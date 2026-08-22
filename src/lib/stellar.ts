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

export const BASE_RESERVE_XLM = 0.5;
