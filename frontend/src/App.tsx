import { useState, useEffect, useRef, useCallback } from 'react';
import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { Shield, Zap, Activity, Lock, BarChart3, Coins, AlertTriangle, ExternalLink, Pause, Play, Wifi, WifiOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Contract IDs ──
const PROXY_PACKAGE_ID = '0x17ef671bb91ed7ac6cf8ad0cae6793db0ddbceb1f93d1d377d617b3a07883632';
const DEEPBOOK_PACKAGE_FULL = '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c';
const POOL_ID = '0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5';
const EXPLORER_BASE = 'https://suiscan.xyz/testnet';
// Engine bot wallet — derived from the mnemonic in engine/.env
const ENGINE_WALLET = '0x8afe1975c973c6440a11fa798cf973ef0de2f7bbc5bfd234f8cd20c309d57603';

// ── Types ──
interface TickData {
  midPrice: number; vol: number; bidPrice: number; askPrice: number;
  spreadBps: number; inventory: number; bidSize: number; askSize: number;
  priceIsReal: boolean; timestamp: number;
}

interface Toast { id: number; message: string; type: 'success' | 'error' | 'info' }

// ── Sparkline Component ──
function Sparkline({ data, width = 300, height = 60 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 8) - 4;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(59,130,246,0.3)" />
          <stop offset="100%" stopColor="rgba(59,130,246,0)" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill="url(#sparkGrad)" />
      <polyline points={points} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export default function App() {
  const account = useCurrentAccount();
  const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();

  // State
  const [activeTab, setActiveTab] = useState<'deploy' | 'monitor' | 'yield'>('deploy');
  const [proxyId, setProxyId] = useState<string | null>(null);
  const [deployDigest, setDeployDigest] = useState<string | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [balanceManagerId, setBalanceManagerId] = useState<string | null>(null);
  const [isWhitelisted, setIsWhitelisted] = useState(false);
  const [isWhitelisting, setIsWhitelisting] = useState(false);
  const [isAgentAuthorized, setIsAgentAuthorized] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);

  // On-chain stats
  const [proxyStats, setProxyStats] = useState<{ totalOrders: number; totalFills: number; currentPosition: number } | null>(null);

  // ── Poll on-chain proxy stats ──
  useEffect(() => {
    if (!proxyId) return;
    const fetchStats = () => {
      fetch('https://fullnode.testnet.sui.io:443', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'sui_getObject',
          params: [proxyId, { showContent: true }]
        })
      }).then(r => r.json()).then(data => {
        const fields = data.result?.data?.content?.fields;
        if (fields?.state?.fields) {
          const s = fields.state.fields;
          setProxyStats({
            totalOrders: Number(s.total_orders_placed || 0),
            totalFills: Number(s.total_fills || 0),
            currentPosition: Number(s.current_position || 0),
          });
        }
      }).catch(() => {});
    };
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [proxyId]);

  // Risk params (editable)
  const [maxPosition, setMaxPosition] = useState(1000);
  const [maxLoss, setMaxLoss] = useState(50);
  const [minSpread, setMinSpread] = useState(10);

  // Engine data
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connected'>('disconnected');
  const [latestTick, setLatestTick] = useState<TickData | null>(null);
  const [priceHistory, setPriceHistory] = useState<number[]>([]);
  const [logs, setLogs] = useState<string[]>(['Awaiting engine connection...']);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  // ── WebSocket Connection ──
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8080');
    ws.onopen = () => setWsStatus('connected');
    ws.onclose = () => setWsStatus('disconnected');
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'tick') {
          const tick: TickData = data;
          setLatestTick(tick);
          setPriceHistory(prev => [...prev.slice(-59), tick.midPrice]);
        } else if (data.type === 'log') {
          setLogs(prev => [data.message, ...prev].slice(0, 30));
        } else if (data.type === 'tx') {
          addToast(`TX confirmed: ${data.digest.slice(0, 12)}...`, 'success');
        }
      } catch { /* ignore malformed */ }
    };
    return () => ws.close();
  }, [addToast]);

  // ── Deploy: Build a real PTB ──
  const handleDeploy = () => {
    if (!account) return;
    setIsDeploying(true);

    const tx = new Transaction();

    // Step 1: Create a BalanceManager
    const [balanceManager] = tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_FULL}::balance_manager::new`,
    });

    // Step 2: Generate a TradeCap from the BalanceManager
    const [tradeCap] = tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_FULL}::balance_manager::mint_trade_cap`,
      arguments: [balanceManager],
    });

    // Step 3: Get the BalanceManager ID
    const [bmId] = tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_FULL}::balance_manager::id`,
      arguments: [balanceManager]
    });

    // Step 4: Create the RiskProxy with on-chain risk limits
    tx.moveCall({
      target: `${PROXY_PACKAGE_ID}::risk_proxy::create_proxy`,
      arguments: [
        tradeCap,
        tx.pure.address(ENGINE_WALLET), // engine bot wallet — authorized to place orders
        bmId, // BalanceManager ID
        tx.pure.u64(maxPosition * 1e9),    // max_position_size in MIST
        tx.pure.u64(maxLoss * 1e6),        // max_loss_per_epoch in USDC decimals
        tx.pure.u64(minSpread),            // min_spread_bps
      ],
    });

    // Share the BalanceManager so the engine bot can reference it in PTBs
    tx.moveCall({
      target: '0x2::transfer::public_share_object',
      typeArguments: [`${DEEPBOOK_PACKAGE_FULL}::balance_manager::BalanceManager`],
      arguments: [balanceManager],
    });

    signAndExecuteTransaction({ transaction: tx }, {
      onSuccess: (result) => {
        // We need to fetch the transaction details to get the created objects
        // The DApp Kit mutate onSuccess only gives us the digest. We'll set the digest and prompt the user to whitelist.
        setDeployDigest(result.digest);
        setIsDeploying(false);
        addToast('Proxy created! Please wait...', 'success');
        
        // We will poll the RPC for the transaction details (it takes a moment to index)
        const fetchChanges = async (retries = 5) => {
          try {
            const res = await fetch(`https://fullnode.testnet.sui.io:443`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'sui_getTransactionBlock',
                params: [result.digest, { showObjectChanges: true }]
              })
            });
            const data = await res.json();
            const changes = data.result?.objectChanges;

            if (!changes) {
              if (retries > 0) {
                setTimeout(() => fetchChanges(retries - 1), 1000);
              } else {
                addToast('Failed to parse created objects after retries.', 'error');
              }
              return;
            }
            
            let foundProxyId = null;
            let foundBmId = null;

            for (const change of changes) {
              if (change.type === 'created') {
                if (change.objectType.includes('::risk_proxy::RiskProxy')) {
                  foundProxyId = change.objectId;
                } else if (change.objectType.includes('::balance_manager::BalanceManager')) {
                  foundBmId = change.objectId;
                }
              }
            }

            if (foundProxyId && foundBmId) {
              setProxyId(foundProxyId);
              setBalanceManagerId(foundBmId);
              addToast('Objects found! Now whitelist the pool.', 'success');
            } else {
              addToast('Failed to find specific objects in transaction.', 'error');
            }
          } catch (e) {
            if (retries > 0) setTimeout(() => fetchChanges(retries - 1), 1000);
            else addToast('Error fetching transaction details.', 'error');
          }
        };

        fetchChanges();
      },
      onError: (err) => {
        setIsDeploying(false);
        addToast(`Deploy failed: ${err.message}`, 'error');
      },
    });
  };

  // ── Whitelist Pool ──
  const handleWhitelistPool = () => {
    if (!account || !proxyId) return;
    setIsWhitelisting(true);
    const tx = new Transaction();
    tx.moveCall({
      target: `${PROXY_PACKAGE_ID}::risk_proxy::add_allowed_pool`,
      arguments: [tx.object(proxyId), tx.object(POOL_ID)],
    });
    signAndExecuteTransaction({ transaction: tx }, {
      onSuccess: () => {
        setIsWhitelisted(true);
        setIsWhitelisting(false);
        addToast('Pool whitelisted successfully!', 'success');
      },
      onError: (err) => {
        setIsWhitelisting(false);
        addToast(`Failed to whitelist: ${err.message}`, 'error');
      },
    });
  };

  // ── Authorize Engine Wallet ──
  const handleAuthorizeEngine = () => {
    if (!account || !proxyId) return;
    setIsAuthorizing(true);
    const tx = new Transaction();
    tx.moveCall({
      target: `${PROXY_PACKAGE_ID}::risk_proxy::update_agent`,
      arguments: [tx.object(proxyId), tx.pure.address(ENGINE_WALLET)],
    });
    signAndExecuteTransaction({ transaction: tx }, {
      onSuccess: () => {
        setIsAgentAuthorized(true);
        setIsAuthorizing(false);
        addToast('Engine wallet authorized! Bot can now trade.', 'success');
      },
      onError: (err) => {
        setIsAuthorizing(false);
        addToast(`Authorization failed: ${err.message}`, 'error');
      },
    });
  };

  // ── Pause/Resume ──
  const handleTogglePause = () => {
    if (!account || !proxyId) return;
    const tx = new Transaction();
    tx.moveCall({
      target: `${PROXY_PACKAGE_ID}::risk_proxy::set_active`,
      arguments: [tx.object(proxyId), tx.pure.bool(isPaused)],
    });
    signAndExecuteTransaction({ transaction: tx }, {
      onSuccess: () => {
        setIsPaused(!isPaused);
        addToast(isPaused ? 'Agent resumed' : 'Agent paused', 'info');
      },
      onError: (err) => addToast(`Failed: ${err.message}`, 'error'),
    });
  };

  // ── Deposit Collateral ──
  const [isDepositing, setIsDepositing] = useState(false);
  const handleDeposit = () => {
    if (!account || !balanceManagerId) return;
    setIsDepositing(true);
    const tx = new Transaction();
    
    // Split 1.1 SUI from gas to deposit (minimum order size + fees)
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1.1 * 1e9)]);
    
    tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_FULL}::balance_manager::deposit`,
      typeArguments: ['0x2::sui::SUI'],
      arguments: [tx.object(balanceManagerId), coin],
    });

    signAndExecuteTransaction({ transaction: tx }, {
      onSuccess: () => {
        setIsDepositing(false);
        addToast('Successfully deposited 1 SUI to BalanceManager!', 'success');
      },
      onError: (err) => {
        setIsDepositing(false);
        addToast(`Deposit failed: ${err.message}`, 'error');
      },
    });
  };

  // ── Claim Rebates ──
  const handleClaimRebates = () => {
    if (!account || !proxyId || !balanceManagerId) {
      addToast('Missing Proxy ID or Balance Manager ID', 'error');
      return;
    }
    setIsClaiming(true);
    const tx = new Transaction();
    tx.moveCall({
      target: `${PROXY_PACKAGE_ID}::risk_proxy::claim_rebates`,
      typeArguments: ['0x2::sui::SUI', '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC'],
      arguments: [tx.object(proxyId), tx.object(POOL_ID), tx.object(balanceManagerId)],
    });
    signAndExecuteTransaction({ transaction: tx }, {
      onSuccess: (result) => {
        setIsClaiming(false);
        addToast(`Rebates claimed! TX: ${result.digest.slice(0, 12)}...`, 'success');
      },
      onError: (err) => {
        setIsClaiming(false);
        addToast(`Claim failed: ${err.message}`, 'error');
      },
    });
  };

  const tabs = [
    { id: 'deploy' as const, label: 'Deploy Agent', icon: <Shield size={18} /> },
    { id: 'monitor' as const, label: 'Monitor', icon: <Activity size={18} /> },
    { id: 'yield' as const, label: 'Yield', icon: <Coins size={18} /> },
  ];

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', position: 'relative' }}>

      {/* ── Toast Notifications ── */}
      <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id} initial={{ opacity: 0, x: 100 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 100 }}
              style={{
                padding: '12px 20px', borderRadius: '12px', fontSize: '0.9rem', fontWeight: 500, maxWidth: '360px',
                background: t.type === 'success' ? 'rgba(16,185,129,0.15)' : t.type === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)',
                border: `1px solid ${t.type === 'success' ? 'rgba(16,185,129,0.3)' : t.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(59,130,246,0.3)'}`,
                color: t.type === 'success' ? '#10b981' : t.type === 'error' ? '#ef4444' : '#3b82f6',
                backdropFilter: 'blur(12px)',
              }}
            >{t.message}</motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ── Header ── */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: 'var(--primary)', padding: '10px', borderRadius: '12px' }}><Zap size={24} color="white" /></div>
          <div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 700, letterSpacing: '-0.5px', lineHeight: 1 }}>SurgeBot</h1>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Autonomous Market Maker · DeepBook V3</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: wsStatus === 'connected' ? '#10b981' : '#ef4444' }}>
            {wsStatus === 'connected' ? <Wifi size={14} /> : <WifiOff size={14} />}
            {wsStatus === 'connected' ? 'Engine Live' : 'Engine Offline'}
          </div>
          <ConnectButton style={{ background: 'var(--bg-card)', color: 'white', border: '1px solid var(--border)', borderRadius: '12px' }} />
        </div>
      </header>

      <main>
        {!account ? (
          <div style={{ textAlign: 'center', marginTop: '10vh' }} className="animate-fade-in">
            <h2 style={{ fontSize: '2.8rem', marginBottom: '1rem', background: 'linear-gradient(135deg, #fff 30%, #3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: 1.2 }}>
              Autonomous Market Making.<br />Trustless Execution.
            </h2>
            <p style={{ fontSize: '1.1rem', color: 'var(--text-muted)', maxWidth: '560px', margin: '1.5rem auto 2.5rem', lineHeight: 1.7 }}>
              Deploy an AI-driven Avellaneda-Stoikov market maker on DeepBook V3. Your funds stay in your wallet — the bot can only trade within on-chain risk limits.
            </p>
            <a href={`${EXPLORER_BASE}/object/${PROXY_PACKAGE_ID}`} target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--primary)', fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}>
              View Contract on Explorer <ExternalLink size={14} />
            </a>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ maxWidth: '800px', margin: '0 auto' }}>
            {/* ── Tabs ── */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '1.5rem', background: 'var(--bg-card)', padding: '6px', borderRadius: '14px', border: '1px solid var(--border)' }}>
              {tabs.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  style={{
                    flex: 1, padding: '10px', borderRadius: '10px', border: 'none',
                    background: activeTab === tab.id ? 'rgba(59,130,246,0.15)' : 'transparent',
                    color: activeTab === tab.id ? 'white' : 'var(--text-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', transition: 'all 0.2s',
                  }}
                >{tab.icon}{tab.label}</button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {/* ════════ DEPLOY TAB ════════ */}
              {activeTab === 'deploy' && (
                <motion.div key="deploy" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                  className="glass-card" style={{ padding: '2.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <Shield size={28} color="var(--primary)" />
                    <h2 style={{ fontSize: '1.6rem' }}>Risk Proxy Setup</h2>
                  </div>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', lineHeight: 1.6, fontSize: '0.95rem' }}>
                    Configure on-chain risk limits, then deploy. The AI engine gets a <strong>TradeCap</strong> locked inside a shared Move object — it can place orders but <strong>cannot withdraw your funds</strong>.
                  </p>

                  {/* Risk Params */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.2rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Max Position (SUI)</label>
                      <input type="number" value={maxPosition} onChange={e => setMaxPosition(Number(e.target.value))} disabled={!!proxyId}
                        style={{ width: '100%', background: 'transparent', border: 'none', color: 'white', fontSize: '1.4rem', fontWeight: 600, outline: 'none', fontFamily: 'inherit' }} />
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.2rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Max Loss / Epoch (USDC)</label>
                      <input type="number" value={maxLoss} onChange={e => setMaxLoss(Number(e.target.value))} disabled={!!proxyId}
                        style={{ width: '100%', background: 'transparent', border: 'none', color: 'white', fontSize: '1.4rem', fontWeight: 600, outline: 'none', fontFamily: 'inherit' }} />
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.2rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Min Spread (bps)</label>
                      <input type="number" value={minSpread} onChange={e => setMinSpread(Number(e.target.value))} disabled={!!proxyId}
                        style={{ width: '100%', background: 'transparent', border: 'none', color: 'white', fontSize: '1.4rem', fontWeight: 600, outline: 'none', fontFamily: 'inherit' }} />
                    </div>
                  </div>

                  {!proxyId ? (
                    <button onClick={handleDeploy} disabled={isDeploying || deployDigest !== null} className="glow-button"
                      style={{ width: '100%', padding: '14px', display: 'flex', justifyContent: 'center', gap: '10px', fontSize: '1rem' }}>
                      <span>{isDeploying ? 'Waiting for wallet approval...' : deployDigest ? 'Parsing Object IDs...' : 'Deploy RiskProxy On-Chain'}</span>
                      {!isDeploying && !deployDigest && <Lock size={18} />}
                    </button>
                  ) : !isWhitelisted ? (
                    <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', padding: '1.5rem', borderRadius: '12px', textAlign: 'center' }}>
                      <AlertTriangle size={28} color="#fbbf24" style={{ margin: '0 auto 8px' }} />
                      <h3 style={{ color: '#fbbf24', marginBottom: '8px' }}>Action Required: Whitelist Pool</h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>Your agent is deployed, but it cannot trade until you authorize the SUI/DBUSDC pool.</p>
                      <button onClick={handleWhitelistPool} disabled={isWhitelisting} className="glow-button"
                        style={{ width: '100%', padding: '12px', background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
                        {isWhitelisting ? 'Whitelisting...' : 'Whitelist SUI/DBUSDC Pool'}
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', padding: '1.5rem', borderRadius: '12px', textAlign: 'center', marginBottom: '1rem' }}>
                        <Activity size={28} color="#10b981" style={{ margin: '0 auto 8px' }} />
                        <h3 style={{ color: '#10b981', marginBottom: '4px' }}>Agent Deployed</h3>
                        {deployDigest && (
                          <a href={`${EXPLORER_BASE}/tx/${deployDigest}`} target="_blank" rel="noopener noreferrer"
                            style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}>
                            TX: {deployDigest.slice(0, 16)}... <ExternalLink size={12} />
                          </a>
                        )}
                      </div>

                      {/* Object IDs */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '1rem' }}>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.8rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px' }}>RiskProxy ID</div>
                          <div style={{ fontSize: '0.75rem', color: '#3b82f6', fontFamily: '"JetBrains Mono", monospace', wordBreak: 'break-all' }}>{proxyId?.slice(0, 16)}...{proxyId?.slice(-8)}</div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.8rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px' }}>BalanceManager ID</div>
                          <div style={{ fontSize: '0.75rem', color: '#3b82f6', fontFamily: '"JetBrains Mono", monospace', wordBreak: 'break-all' }}>{balanceManagerId?.slice(0, 16)}...{balanceManagerId?.slice(-8)}</div>
                        </div>
                      </div>

                      {/* Authorize Engine Step */}
                      {!isAgentAuthorized && (
                        <div style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)', padding: '1.2rem', borderRadius: '12px', textAlign: 'center', marginBottom: '1rem' }}>
                          <Zap size={22} color="#8b5cf6" style={{ margin: '0 auto 6px' }} />
                          <h4 style={{ color: '#8b5cf6', marginBottom: '4px', fontSize: '0.95rem' }}>Authorize Engine Bot</h4>
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '10px' }}>
                            Allow the AI engine ({ENGINE_WALLET.slice(0, 8)}...{ENGINE_WALLET.slice(-6)}) to place orders through your proxy.
                          </p>
                          <button onClick={handleAuthorizeEngine} disabled={isAuthorizing} className="glow-button"
                            style={{ width: '100%', padding: '10px', background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', fontSize: '0.9rem' }}>
                            {isAuthorizing ? 'Authorizing...' : 'Authorize Engine Wallet'}
                          </button>
                        </div>
                      )}

                      {/* On-chain Stats */}
                      {proxyStats && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '1rem' }}>
                          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border)', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Orders Placed</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#3b82f6' }}>{proxyStats.totalOrders}</div>
                          </div>
                          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border)', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Total Fills</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#10b981' }}>{proxyStats.totalFills}</div>
                          </div>
                          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border)', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Position (raw)</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f59e0b' }}>{proxyStats.currentPosition}</div>
                          </div>
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <button onClick={handleDeposit} disabled={isDepositing} className="glow-button"
                          style={{ width: '100%', padding: '12px', display: 'flex', justifyContent: 'center', gap: '8px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}>
                          {isDepositing ? 'Depositing...' : <><Coins size={16} /><span>Deposit 1 SUI</span></>}
                        </button>

                        <button onClick={handleTogglePause} className="glow-button"
                          style={{ width: '100%', padding: '12px', display: 'flex', justifyContent: 'center', gap: '8px', background: isPaused ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #ef4444, #dc2626)' }}>
                          {isPaused ? <><Play size={16} /><span>Resume Agent</span></> : <><Pause size={16} /><span>Pause Agent</span></>}
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* ════════ MONITOR TAB ════════ */}
              {activeTab === 'monitor' && (
                <motion.div key="monitor" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                  className="glass-card" style={{ padding: '2.5rem' }}>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <BarChart3 size={28} color="var(--primary)" />
                      <h2 style={{ fontSize: '1.6rem' }}>Live Engine Monitor</h2>
                    </div>
                    {latestTick && (
                      <span style={{
                        fontSize: '0.75rem', padding: '4px 10px', borderRadius: '20px',
                        background: latestTick.priceIsReal ? 'rgba(16,185,129,0.15)' : 'rgba(251,191,36,0.15)',
                        color: latestTick.priceIsReal ? '#10b981' : '#fbbf24',
                      }}>
                        {latestTick.priceIsReal ? '● LIVE' : '● SIMULATED'}
                      </span>
                    )}
                  </div>

                  {/* Data Cards */}
                  {latestTick ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px', marginBottom: '1.5rem' }}>
                      {[
                        { label: 'Mid Price', value: `$${latestTick.midPrice.toFixed(4)}`, color: '#3b82f6' },
                        { label: 'Volatility', value: `${(latestTick.vol * 100).toFixed(2)}%`, color: '#8b5cf6' },
                        { label: 'Spread', value: `${latestTick.spreadBps.toFixed(0)} bps`, color: '#f59e0b' },
                        { label: 'Inventory', value: `${latestTick.inventory}`, color: '#10b981' },
                      ].map(card => (
                        <div key={card.label} style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>{card.label}</div>
                          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: card.color }}>{card.value}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#fbbf24', background: 'rgba(251,191,36,0.08)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
                      <AlertTriangle size={18} />
                      <span style={{ fontSize: '0.9rem' }}>{wsStatus === 'connected' ? 'Waiting for first tick...' : 'Engine not connected. Run `npm run dev` in /engine.'}</span>
                    </div>
                  )}

                  {/* Sparkline */}
                  {priceHistory.length > 1 && (
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Price History (last {priceHistory.length} ticks)</div>
                      <Sparkline data={priceHistory} width={680} height={50} />
                    </div>
                  )}

                  {/* Log Feed */}
                  <div style={{ background: '#000', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border)', maxHeight: '220px', overflow: 'auto', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.78rem' }}>
                    <div style={{ color: '#10b981', marginBottom: '8px' }}>$ surgebot-engine --network testnet</div>
                    {logs.map((log, i) => (
                      <div key={i} style={{ color: i === 0 ? 'white' : 'var(--text-muted)', marginBottom: '4px', opacity: Math.max(0.3, 1 - i * 0.04) }}>{log}</div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* ════════ YIELD TAB ════════ */}
              {activeTab === 'yield' && (
                <motion.div key="yield" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                  className="glass-card" style={{ padding: '2.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <Coins size={28} color="var(--primary)" />
                    <h2 style={{ fontSize: '1.6rem' }}>DEEP Maker Rebates</h2>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem', lineHeight: 1.6 }}>
                    DeepBook V3 rewards makers with DEEP token rebates. Your RiskProxy automatically accumulates these as it quotes. Claim them to your wallet anytime.
                  </p>

                  <div style={{ background: 'rgba(0,0,0,0.3)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border)', textAlign: 'center', marginBottom: '1.5rem' }}>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Unclaimed DEEP Rebates</div>
                    <div style={{ fontSize: '2.8rem', fontWeight: 700, background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                      {proxyId ? '0.00 DEEP' : '—'}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {proxyId ? 'No trades executed yet — rebates accrue after maker orders fill' : 'Deploy proxy to start earning'}
                    </div>
                  </div>

                  <button onClick={handleClaimRebates} disabled={!proxyId || isClaiming} className="glow-button" style={{ width: '100%', padding: '14px', fontSize: '1rem', marginBottom: '1rem' }}>
                    {isClaiming ? 'Signing...' : 'Claim Rebates to Wallet'}
                  </button>

                  <a href={`${EXPLORER_BASE}/object/${PROXY_PACKAGE_ID}`} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'none' }}>
                    View contract on Sui Explorer <ExternalLink size={12} />
                  </a>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer style={{ textAlign: 'center', padding: '3rem 0 1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
        Built on <a href="https://sui.io" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>Sui</a> ·{' '}
        <a href={`${EXPLORER_BASE}/object/${PROXY_PACKAGE_ID}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
          Contract <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
        </a>
      </footer>
    </div>
  );
}
