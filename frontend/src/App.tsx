import { useState } from 'react';
import { ConnectButton, useCurrentAccount } from '@mysten/dapp-kit';
import { Shield, Zap, Activity, Lock } from 'lucide-react';
import { motion } from 'framer-motion';

// Using a mock DeepBook Registry and Pool ID for UI demonstration. In production, these are fetched from the DeepBook V3 SDK.

export default function App() {
  const account = useCurrentAccount();
  const [isDeploying, setIsDeploying] = useState(false);
  const [proxyId, setProxyId] = useState<string | null>(null);

  const handleDeployAgent = async () => {
    if (!account) return;
    setIsDeploying(true);
    
    try {
      // const tx = new Transaction();
      
      // In a full implementation, we'd use DeepBook SDK to create balance manager and mint TradeCap.
      // For the UI demo, we simulate the structure of the PTB that calls our risk_proxy contract.
      /*
      const [balanceManager, depositCap, withdrawCap, tradeCap] = tx.moveCall({
        target: `0x...::balance_manager::new_with_custom_owner_caps_v2`,
        arguments: [ ... ]
      });
      
      tx.moveCall({
        target: `${PROXY_PACKAGE_ID}::risk_proxy::create_proxy`,
        arguments: [
          tradeCap,
          tx.pure.address(AI_AGENT_ADDRESS), // agent
          tx.object(balanceManager),         // balance manager ID
          tx.pure.u64(1000000),              // max_position_size
          tx.pure.u64(5000000),              // max_loss_per_epoch
          tx.pure.u64(10),                   // min_spread_bps
        ]
      });
      
      // Transfer the caps you want to keep to yourself
      tx.transferObjects([withdrawCap, depositCap, balanceManager], tx.pure.address(account.address));
      */

      // Simulated deployment delay for the UI
      await new Promise(r => setTimeout(r, 2000));
      setProxyId('0x8c28...35f21d');
      
    } catch (e) {
      console.error(e);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4rem' }} className="animate-fade-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: 'var(--primary)', padding: '10px', borderRadius: '12px' }}>
            <Zap size={24} color="white" />
          </div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700, letterSpacing: '-0.5px' }}>SurgeBot</h1>
        </div>
        <ConnectButton style={{ background: 'var(--bg-card)', color: 'white', border: '1px solid var(--border)', borderRadius: '12px' }} />
      </header>

      {/* Main Content */}
      <main>
        {!account ? (
          <div style={{ textAlign: 'center', marginTop: '10vh' }} className="animate-fade-in">
            <h2 style={{ fontSize: '3rem', marginBottom: '1rem', background: 'linear-gradient(to right, #fff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Autonomous Market Making. <br/>Trustless Execution.
            </h2>
            <p style={{ fontSize: '1.2rem', color: 'var(--text-muted)', marginBottom: '3rem', maxWidth: '600px', margin: '0 auto 3rem auto' }}>
              Connect your wallet to deploy an AI-driven Avellaneda-Stoikov market maker on DeepBook V3. You retain full custody of your funds.
            </p>
          </div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card" 
            style={{ padding: '3rem', maxWidth: '800px', margin: '0 auto' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
              <Shield size={32} color="var(--primary)" />
              <h2 style={{ fontSize: '2rem' }}>Risk Proxy Setup</h2>
            </div>
            
            <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', lineHeight: '1.6' }}>
              You are about to delegate trading authority to the SurgeBot AI Engine. The bot will use your funds to provide liquidity on DeepBook V3. 
              <strong> The AI cannot withdraw your funds.</strong> It can only trade within the risk parameters defined below.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '3rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Max Position Size</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>1,000 SUI</div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Max Daily Drawdown</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>50 USDC</div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Min Spread</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>10 bps</div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Target Pools</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>SUI/USDC</div>
              </div>
            </div>

            {!proxyId ? (
              <button 
                onClick={handleDeployAgent}
                disabled={isDeploying}
                className="glow-button"
                style={{ width: '100%', padding: '1rem', fontSize: '1.2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }}
              >
                <span>{isDeploying ? 'Deploying Proxy...' : 'Deploy AI Agent Proxy'}</span>
                {!isDeploying && <Lock size={20} />}
              </button>
            ) : (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '1.5rem', borderRadius: '12px', textAlign: 'center' }}
              >
                <Activity size={32} color="#10b981" style={{ margin: '0 auto 1rem auto' }} />
                <h3 style={{ color: '#10b981', marginBottom: '0.5rem' }}>Agent Deployed Successfully</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Proxy ID: {proxyId}</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '1rem' }}>The AI Engine is now quoting on DeepBook V3.</p>
              </motion.div>
            )}
          </motion.div>
        )}
      </main>
    </div>
  );
}
