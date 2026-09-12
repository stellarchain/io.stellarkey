import { FeeBumpTransaction, StrKey, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import type { AssetStatus, Client } from '../../../../protocol/private-balance/generated/pool-client/src';

export type PrivateAssetAdminStage =
  | 'preparing'
  | 'signing'
  | 'submitting'
  | 'pending'
  | 'confirmed';

export type PrivateAssetAdminAction =
  | { type: 'add'; contractId: string }
  | { type: 'status'; index: number; status: 'active' | 'exit-only' };

interface AssetAdminClientOptions {
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
  publicKey: string;
  signTransaction(
    xdr: string,
    options?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string; signerAddress?: string }>;
}

interface AssetAdminAssembledTransaction {
  sign(): Promise<void>;
  send(watcher?: {
    onSubmitted?(): void;
    onProgress?(): void;
  }): Promise<{
    getTransactionResponse?: { status?: string; txHash?: string };
    sendTransactionResponse?: { hash?: string };
  }>;
}

interface AssetAdminClient {
  add_asset(input: { asset: string }): Promise<AssetAdminAssembledTransaction>;
  set_asset_status(input: { index: number; status: AssetStatus }): Promise<AssetAdminAssembledTransaction>;
}

interface ExecutePrivateAssetAdminDependencies {
  createClient?(options: AssetAdminClientOptions): Promise<AssetAdminClient>;
  transactionHash?(xdr: string, networkPassphrase: string): string;
}

function defaultTransactionHash(xdr: string, networkPassphrase: string): string {
  const parsed = TransactionBuilder.fromXdr(xdr, networkPassphrase);
  if (parsed instanceof FeeBumpTransaction || !(parsed instanceof Transaction)) {
    throw new Error('Private asset administration envelope type is unsupported.');
  }
  return Array.from(parsed.hash(), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function defaultClient(options: AssetAdminClientOptions): Promise<AssetAdminClient> {
  const { Client: PoolClient } = await import(
    '../../../../protocol/private-balance/generated/pool-client/src/index'
  );
  return new PoolClient(options) as Client as AssetAdminClient;
}

export async function executePrivateAssetAdminAction(input: {
  action: PrivateAssetAdminAction;
  poolContractId: string;
  adminPublicKey: string;
  networkPassphrase: string;
  rpcUrl: string;
  sign(request: {
    envelopeXdr: string;
    expectedTransactionHash: string;
    networkPassphrase: string;
  }): Promise<string>;
  onStage?(stage: PrivateAssetAdminStage): void;
}, dependencies: ExecutePrivateAssetAdminDependencies = {}): Promise<{ transactionHash: string }> {
  if (!StrKey.isValidContract(input.poolContractId)) {
    throw new Error('Private pool contract is invalid.');
  }
  if (!StrKey.isValidEd25519PublicKey(input.adminPublicKey)) {
    throw new Error('Private asset administrator account is invalid.');
  }
  if (input.action.type === 'add' && !StrKey.isValidContract(input.action.contractId)) {
    throw new Error('Asset must be a valid Stellar contract address.');
  }
  if (
    input.action.type === 'status' &&
    (!Number.isSafeInteger(input.action.index) || input.action.index < 0 || input.action.index > 255)
  ) {
    throw new Error('Private asset registry index is invalid.');
  }
  const endpoint = new URL(input.rpcUrl);
  if (endpoint.protocol !== 'https:' && !(
    endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
  )) {
    throw new Error('Private asset administration requires an HTTPS or loopback RPC.');
  }
  input.onStage?.('preparing');
  const hash = dependencies.transactionHash ?? defaultTransactionHash;
  const createClient = dependencies.createClient ?? defaultClient;
  const client = await createClient({
    contractId: input.poolContractId,
    networkPassphrase: input.networkPassphrase,
    rpcUrl: endpoint.toString(),
    publicKey: input.adminPublicKey,
    signTransaction: async (xdr, options) => {
      if (
        options?.networkPassphrase && options.networkPassphrase !== input.networkPassphrase ||
        options?.address && options.address !== input.adminPublicKey
      ) {
        throw new Error('Private asset administration signing context changed.');
      }
      input.onStage?.('signing');
      const transactionHash = hash(xdr, input.networkPassphrase);
      const signedTxXdr = await input.sign({
        envelopeXdr: xdr,
        expectedTransactionHash: transactionHash,
        networkPassphrase: input.networkPassphrase,
      });
      return { signedTxXdr, signerAddress: input.adminPublicKey };
    },
  });
  const assembled = input.action.type === 'add'
    ? await client.add_asset({ asset: input.action.contractId })
    : await client.set_asset_status({
        index: input.action.index,
        status: input.action.status === 'active'
          ? { tag: 'Active', values: undefined }
          : { tag: 'ExitOnly', values: undefined },
      });
  await assembled.sign();
  input.onStage?.('submitting');
  const sent = await assembled.send({
    onSubmitted: () => input.onStage?.('pending'),
  });
  if (sent.getTransactionResponse?.status && sent.getTransactionResponse.status !== 'SUCCESS') {
    throw new Error('Private asset administration was not confirmed by the ledger.');
  }
  const transactionHash = sent.getTransactionResponse?.txHash ?? sent.sendTransactionResponse?.hash;
  if (!transactionHash || !/^[0-9a-f]{64}$/iu.test(transactionHash)) {
    throw new Error('Private asset administration confirmation did not include a transaction hash.');
  }
  input.onStage?.('confirmed');
  return { transactionHash: transactionHash.toLowerCase() };
}
