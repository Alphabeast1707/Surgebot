import { DeepBookClient } from '@mysten/deepbook-v3';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
const deepbook = new DeepBookClient({ suiClient, network: 'testnet' });

async function run() {
    const poolId = "0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5";
    const pool = await deepbook.getPool(poolId);
    console.log("Min size:", pool.minSize);
    console.log("Tick size:", pool.tickSize);
    console.log("Lot size:", pool.lotSize);
}
run().catch(console.error);
