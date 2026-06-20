import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { DeepBookClient } from '@mysten/deepbook-v3';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

export class SurgeClient {
  public suiClient: SuiJsonRpcClient;
  public deepbook: DeepBookClient;
  public keypair?: Ed25519Keypair;
  private proxyId: string;
  private poolKey: string;        // DeepBook SDK pool key, e.g. "SUI_DBUSDC"
  private poolAddress: string;    // On-chain pool object ID for PTBs
  private balanceManagerId: string;

  constructor(
    network: 'mainnet' | 'testnet',
    privateKey: string,
    proxyId: string,
    poolKey: string,
    poolAddress: string,
    balanceManagerId: string
  ) {
    this.suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });
    this.deepbook = new DeepBookClient({
      address: '0x0000000000000000000000000000000000000000000000000000000000000000',
      client: this.suiClient as any,
      network: network || 'testnet',
    });
    this.proxyId = proxyId;
    this.poolKey = poolKey;
    this.poolAddress = poolAddress;
    this.balanceManagerId = balanceManagerId;

    if (privateKey) {
      // Try Bech32 format first (suiprivkey1q...), then mnemonic
      try {
        const parsed = decodeSuiPrivateKey(privateKey);
        this.keypair = Ed25519Keypair.fromSecretKey(parsed.secretKey);
      } catch {
        try {
          this.keypair = Ed25519Keypair.deriveKeypair(privateKey);
        } catch {
          console.error('❌ SUI_PRIVATE_KEY is not a valid Bech32 key or mnemonic.');
        }
      }

      if (this.keypair) {
        console.log(`🔑 Agent wallet: ${this.keypair.toSuiAddress()}`);
      }
    }
  }

  /** Gets the mid price from the DeepBook V3 pool using the SDK pool key */
  async getMidPrice(): Promise<number> {
    try {
      return await this.deepbook.midPrice(this.poolKey);
    } catch {
      // If the SDK query fails (e.g., no liquidity), query Sui RPC directly
      // to extract the mid from the pool object's on-chain state.
      try {
        const obj = await this.suiClient.getObject({
          id: this.poolAddress,
          options: { showContent: true },
        }) as any;
        const fields = obj?.data?.content?.fields;
        if (fields?.mid_price) {
          return Number(fields.mid_price) / 1e9;
        }
      } catch { /* ignore */ }
      // Ultimate fallback: return NaN so the caller knows it's not real
      return NaN;
    }
  }

  /** Constructs and executes the PTB to place BID + ASK via our RiskProxy */
  async executeOrders(
    bidPrice: number, bidSize: number,
    askPrice: number, askSize: number
  ): Promise<{ success: boolean; digest?: string; error?: string }> {
    if (!this.keypair) {
      return { success: false, error: 'no_keypair' };
    }
    if (!this.proxyId || !this.poolAddress || !this.balanceManagerId) {
      return { success: false, error: 'missing_config' };
    }

    const tx = new Transaction();
    const clockId = '0x6';
    const packageId = process.env.PROXY_PACKAGE_ID;
    const typeArgs = [
      '0x2::sui::SUI',
      '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC',
    ] as const;

    // BID order
    if (bidSize > 0) {
      tx.moveCall({
        target: `${packageId}::risk_proxy::place_limit_order`,
        typeArguments: [...typeArgs],
        arguments: [
          tx.object(this.proxyId),
          tx.object(this.poolAddress),
          tx.object(this.balanceManagerId),
          tx.pure.u64(Date.now()),
          tx.pure.u8(0), // order_type: NO_RESTRICTION
          tx.pure.u8(0), // self_matching_option
          tx.pure.u64(Math.floor(bidPrice * 1e6)),
          tx.pure.u64(Math.floor(bidSize * 1e9)),
          tx.pure.bool(true),
          tx.pure.bool(false),
          tx.pure.u64(Date.now() + 60000),
          tx.object(clockId),
        ],
      });
    }

    // ASK order
    if (askSize > 0) {
      tx.moveCall({
        target: `${packageId}::risk_proxy::place_limit_order`,
        typeArguments: [...typeArgs],
        arguments: [
          tx.object(this.proxyId),
          tx.object(this.poolAddress),
          tx.object(this.balanceManagerId),
          tx.pure.u64(Date.now() + 1),
          tx.pure.u8(0),
          tx.pure.u8(0),
          tx.pure.u64(Math.floor(askPrice * 1e6)),
          tx.pure.u64(Math.floor(askSize * 1e9)),
          tx.pure.bool(false),
          tx.pure.bool(false),
          tx.pure.u64(Date.now() + 60000),
          tx.object(clockId),
        ],
      });
    }

    if (bidSize === 0 && askSize === 0) return { success: true, digest: 'skip' };

    try {
      const result = await this.suiClient.signAndExecuteTransaction({
        transaction: tx,
        signer: this.keypair,
      });
      return { success: true, digest: result.digest };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
}
