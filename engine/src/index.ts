import { config } from 'dotenv';
import { WebSocketServer } from 'ws';
import { SurgeClient } from './client.js';
import { AvellanedaStoikov } from './strategy/avellaneda.js';
import type { AvellanedaParams } from './strategy/avellaneda.js';
import { VolatilityEstimator } from './strategy/volatility.js';
import { InventoryManager } from './strategy/inventory.js';

config();

const SUI_NETWORK = (process.env.SUI_NETWORK || 'testnet') as 'testnet' | 'mainnet';
const SUI_PRIVATE_KEY = process.env.SUI_PRIVATE_KEY || '';
const PROXY_CONTRACT_ID = process.env.PROXY_CONTRACT_ID || '';
const DEEPBOOK_POOL_KEY = process.env.DEEPBOOK_POOL_KEY || 'SUI_DBUSDC';
const DEEPBOOK_POOL_ADDRESS = process.env.DEEPBOOK_POOL_ADDRESS || '';
const BALANCE_MANAGER_ID = process.env.BALANCE_MANAGER_ID || '';

// ──── WebSocket Server ────
const wss = new WebSocketServer({ port: 8080 });
const wsClients = new Set<any>();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  broadcast('log', '🟢 Connected to SurgeBot Engine.');
  ws.on('close', () => wsClients.delete(ws));
});

function broadcast(type: string, data: any) {
  const payload = typeof data === 'string'
    ? JSON.stringify({ type, message: data })
    : JSON.stringify({ type, ...data });

  if (type === 'log') console.log(typeof data === 'string' ? data : JSON.stringify(data));

  for (const client of wsClients) {
    if (client.readyState === 1) client.send(payload);
  }
}

// ──── Main ────
async function main() {
  broadcast('log', `🚀 SurgeBot Engine starting on ${SUI_NETWORK}`);

  const client = new SurgeClient(
    SUI_NETWORK,
    SUI_PRIVATE_KEY,
    PROXY_CONTRACT_ID,
    DEEPBOOK_POOL_KEY,
    DEEPBOOK_POOL_ADDRESS,
    BALANCE_MANAGER_ID,
  );

  if (client.keypair) {
    broadcast('log', `🔑 Agent wallet loaded: ${client.keypair.toSuiAddress()}`);
  } else {
    broadcast('log', '⚠️  No valid keypair — running in dry-run mode.');
  }

  const volatilityEstimator = new VolatilityEstimator(0.94);
  const inventoryManager = new InventoryManager({ maxPositionSize: 1, baseQuoteSize: 1.0 });
  const riskAversion = 0.05;
  const timeHorizon = 0.01;
  const orderArrivalRate = 1.5;

  broadcast('log', '📊 Strategy initialized. Starting main loop (3s cycles)...');

  setInterval(async () => {
    try {
      // Step A: Observe Market State
      let midPrice = await client.getMidPrice();
      const priceIsReal = !isNaN(midPrice);
      if (!priceIsReal) midPrice = 3.45 + (Math.random() * 0.04 - 0.02);

      // Step B: Estimate Volatility
      volatilityEstimator.update(midPrice);
      const vol = volatilityEstimator.getVolatility();

      // Step C: Calculate Quotes
      const params: AvellanedaParams = {
        midPrice,
        inventory: inventoryManager.getPosition(),
        riskAversion,
        volatility: vol,
        timeHorizon,
        orderArrivalRate,
      };
      const quotes = AvellanedaStoikov.calculateQuotes(params);
      const sizes = inventoryManager.calculateAdjustedSizes();
      
      // Round prices and sizes to match pool tick_size and lot_size
      quotes.bidPrice = Math.floor(quotes.bidPrice * 1000) / 1000;
      quotes.askPrice = Math.ceil(quotes.askPrice * 1000) / 1000;
      sizes.bidSize = 0; // Force BID size to 0 since we have no DBUSDC
      sizes.askSize = Math.floor(sizes.askSize * 100) / 100;

      const spreadBps = quotes.optimalSpread * 10000;

      // Broadcast structured tick data for the dashboard
      broadcast('tick', {
        midPrice,
        vol,
        bidPrice: quotes.bidPrice,
        askPrice: quotes.askPrice,
        spreadBps,
        inventory: inventoryManager.getPosition(),
        bidSize: sizes.bidSize,
        askSize: sizes.askSize,
        priceIsReal,
        timestamp: Date.now(),
      });

      // Broadcast human-readable log
      const src = priceIsReal ? 'LIVE' : 'SIM';
      broadcast('log',
        `[${src}] Mid $${midPrice.toFixed(4)} | Vol ${(vol * 100).toFixed(2)}% | Spread ${spreadBps.toFixed(0)} bps | BID $${quotes.bidPrice.toFixed(4)}×${sizes.bidSize.toFixed(0)} ASK $${quotes.askPrice.toFixed(4)}×${sizes.askSize.toFixed(0)}`
      );

      // Step D: Execute on-chain
      if (client.keypair && PROXY_CONTRACT_ID && BALANCE_MANAGER_ID) {
        const result = await client.executeOrders(quotes.bidPrice, sizes.bidSize, quotes.askPrice, sizes.askSize);
        if (result.success) {
          broadcast('log', `⚡ TX: ${result.digest}`);
          broadcast('tx', { digest: result.digest, network: SUI_NETWORK });
        } else {
          broadcast('log', `⚠️ TX skipped: ${result.error}`);
        }
      }
    } catch (e: any) {
      broadcast('log', `❌ Error: ${e.message}`);
    }
  }, 3000);
}

main().catch(console.error);
