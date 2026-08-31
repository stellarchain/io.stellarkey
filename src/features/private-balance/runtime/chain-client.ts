import { rpc as SorobanRpc, xdr, Address } from '@stellar/stellar-sdk';
import type { PrivateBalanceManifest } from '../../../lib/private-balance-manifest';

interface PrivateBalanceRpc {
  getLatestLedger(): Promise<{ sequence: number }>;
  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<{ entries?: readonly unknown[] }>;
}

function decodeHex32(value: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('Nullifier must be exactly 64 hexadecimal characters');
  }
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

export class PrivateBalanceChainClient {
  private readonly server: PrivateBalanceRpc;
  private readonly manifest: Pick<PrivateBalanceManifest, 'poolContractId'>;

  constructor(
    rpcUrl: string,
    manifest: Pick<PrivateBalanceManifest, 'poolContractId'>,
    server?: PrivateBalanceRpc,
  ) {
    const endpoint = new URL(rpcUrl);
    const localHttp =
      endpoint.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'https:' && !localHttp) {
      throw new Error('Private Balance RPC requires HTTPS or a loopback development endpoint');
    }
    this.server = server ?? new SorobanRpc.Server(endpoint.toString(), { allowHttp: localHttp });
    this.manifest = manifest;
  }

  public async getLatestLedger(): Promise<number> {
    const latest = await this.server.getLatestLedger();
    return latest.sequence;
  }

  public async isNullifierSpent(nullifierHex: string): Promise<boolean> {
    const nullifier = decodeHex32(nullifierHex);
    const contractAddress = Address.fromString(this.manifest.poolContractId);
    const key = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: contractAddress.toScAddress(),
        key: xdr.ScVal.scvVec([
          xdr.ScVal.scvSymbol('Nullifier'),
          xdr.ScVal.scvBytes(nullifier),
        ]),
        durability: xdr.ContractDataDurability.persistent,
      }),
    );

    const response = await this.server.getLedgerEntries(key);
    return (response.entries?.length ?? 0) > 0;
  }
}
