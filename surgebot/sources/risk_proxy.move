// Copyright (c) 2026 DeepSurge
// SPDX-License-Identifier: Apache-2.0

module surgebot::risk_proxy {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Self, Clock};
    use sui::vec_set::{Self, VecSet};
    use sui::event;
    
    use deepbook::balance_manager::{Self, BalanceManager, TradeCap};
    use deepbook::pool::{Self, Pool};
    use deepbook::order_info::{Self, OrderInfo};

    // === Errors ===
    const ENotOwner: u64 = 0;
    const ENotAuthorizedAgent: u64 = 1;
    const EAgentPaused: u64 = 2;
    const EPoolNotAllowed: u64 = 3;
    const EPositionLimitExceeded: u64 = 4;
    const ELossLimitExceeded: u64 = 5;
    const ESpreadTooTight: u64 = 6;
    const EInvalidSpreadConfig: u64 = 7;

    // === Structs ===
    
    /// The core security wrapper. A shared object that holds the user's TradeCap
    /// and enforces risk limits before forwarding calls to DeepBook.
    public struct RiskProxy has key {
        id: UID,
        owner: address,
        agent: address,
        trade_cap: TradeCap,
        config: RiskConfig,
        state: AgentState,
    }

    /// Configuration parameters set by the owner
    public struct RiskConfig has store {
        allowed_pools: VecSet<ID>,
        max_position_size: u64,     // Base asset max inventory
        max_loss_per_epoch: u64,    // USDC/Quote max loss
        min_spread_bps: u64,        // Minimum allowed spread
        is_active: bool,
    }

    /// Real-time state tracked by the contract
    public struct AgentState has store {
        current_position: u64,      // Absolute size of current position (simplified)
        epoch_loss: u64,            // Loss since last epoch reset
        total_orders_placed: u64,
        total_fills: u64,
    }

    // === Events ===
    
    public struct ProxyCreatedEvent has copy, drop {
        proxy_id: ID,
        owner: address,
        agent: address,
        balance_manager_id: ID,
    }

    // === Core Functions ===

    /// Create a new RiskProxy. The owner transfers their TradeCap to this contract.
    public fun create_proxy(
        trade_cap: TradeCap, 
        agent: address, 
        balance_manager_id: ID,
        max_position_size: u64,
        max_loss_per_epoch: u64,
        min_spread_bps: u64,
        ctx: &mut TxContext
    ) {
        let owner = tx_context::sender(ctx);
        let id = object::new(ctx);
        
        event::emit(ProxyCreatedEvent {
            proxy_id: object::uid_to_inner(&id),
            owner,
            agent,
            balance_manager_id,
        });

        let proxy = RiskProxy {
            id,
            owner,
            agent,
            trade_cap,
            config: RiskConfig {
                allowed_pools: vec_set::empty(),
                max_position_size,
                max_loss_per_epoch,
                min_spread_bps,
                is_active: true,
            },
            state: AgentState {
                current_position: 0,
                epoch_loss: 0,
                total_orders_placed: 0,
                total_fills: 0,
            }
        };

        transfer::share_object(proxy);
    }

    /// Pause or resume the agent. Only owner.
    public fun set_active(proxy: &mut RiskProxy, active: bool, ctx: &mut TxContext) {
        assert!(tx_context::sender(ctx) == proxy.owner, ENotOwner);
        proxy.config.is_active = active;
    }

    /// Add a pool to the whitelist. Only owner.
    public fun add_allowed_pool(proxy: &mut RiskProxy, pool_id: ID, ctx: &mut TxContext) {
        assert!(tx_context::sender(ctx) == proxy.owner, ENotOwner);
        if (!vec_set::contains(&proxy.config.allowed_pools, &pool_id)) {
            vec_set::insert(&mut proxy.config.allowed_pools, pool_id);
        }
    }

    /// Remove a pool from the whitelist. Only owner.
    public fun remove_allowed_pool(proxy: &mut RiskProxy, pool_id: ID, ctx: &mut TxContext) {
        assert!(tx_context::sender(ctx) == proxy.owner, ENotOwner);
        if (vec_set::contains(&proxy.config.allowed_pools, &pool_id)) {
            vec_set::remove(&mut proxy.config.allowed_pools, &pool_id);
        }
    }

    /// Update the authorized agent address. Only owner.
    public fun update_agent(proxy: &mut RiskProxy, new_agent: address, ctx: &mut TxContext) {
        assert!(tx_context::sender(ctx) == proxy.owner, ENotOwner);
        proxy.agent = new_agent;
    }

    /// Update risk configuration limits. Only owner.
    public fun update_risk_config(
        proxy: &mut RiskProxy, 
        max_position_size: u64,
        max_loss_per_epoch: u64,
        min_spread_bps: u64,
        ctx: &mut TxContext
    ) {
        assert!(tx_context::sender(ctx) == proxy.owner, ENotOwner);
        proxy.config.max_position_size = max_position_size;
        proxy.config.max_loss_per_epoch = max_loss_per_epoch;
        proxy.config.min_spread_bps = min_spread_bps;
    }

    /// Forward place_limit_order to DeepBook after risk checks
    public fun place_limit_order<BaseAsset, QuoteAsset>(
        proxy: &mut RiskProxy,
        pool: &mut Pool<BaseAsset, QuoteAsset>,
        balance_manager: &mut BalanceManager,
        client_order_id: u64,
        order_type: u8,
        self_matching_option: u8,
        price: u64,
        quantity: u64,
        is_bid: bool,
        pay_with_deep: bool,
        expire_timestamp: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ): OrderInfo {
        // 1. Authorization & Active Check
        assert!(tx_context::sender(ctx) == proxy.agent, ENotAuthorizedAgent);
        assert!(proxy.config.is_active, EAgentPaused);
        
        // 2. Pool Whitelist Check
        let pool_id = object::id(pool);
        assert!(vec_set::contains(&proxy.config.allowed_pools, &pool_id), EPoolNotAllowed);

        // 3. Position Limit Check
        // (In a full implementation, we track net position properly using fill events.
        // Here we restrict the order size to the max position for safety.)
        assert!(quantity <= proxy.config.max_position_size, EPositionLimitExceeded);

        // 4. Loss Limit Check
        assert!(proxy.state.epoch_loss <= proxy.config.max_loss_per_epoch, ELossLimitExceeded);

        // Update state
        proxy.state.total_orders_placed = proxy.state.total_orders_placed + 1;

        // Generate proof using our locked TradeCap
        let proof = balance_manager::generate_proof_as_trader(balance_manager, &proxy.trade_cap, ctx);

        // Forward to DeepBook
        let order_info = pool::place_limit_order(
            pool,
            balance_manager,
            &proof,
            client_order_id,
            order_type,
            self_matching_option,
            price,
            quantity,
            is_bid,
            pay_with_deep,
            expire_timestamp,
            clock,
            ctx
        );

        let executed_qty = order_info::executed_quantity(&order_info);
        
        if (executed_qty > 0) {
            proxy.state.total_fills = proxy.state.total_fills + 1;
            
            // Simplified position tracking: track absolute size 
            // (In a real delta-neutral MM, this would track long vs short exposure accurately)
            proxy.state.current_position = proxy.state.current_position + executed_qty;
        };

        order_info
    }

    /// Forward cancel_order to DeepBook
    public fun cancel_order<BaseAsset, QuoteAsset>(
        proxy: &mut RiskProxy,
        pool: &mut Pool<BaseAsset, QuoteAsset>,
        balance_manager: &mut BalanceManager,
        order_id: u128,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(tx_context::sender(ctx) == proxy.agent || tx_context::sender(ctx) == proxy.owner, ENotAuthorizedAgent);
        
        let proof = balance_manager::generate_proof_as_trader(balance_manager, &proxy.trade_cap, ctx);
        
        pool::cancel_order(
            pool,
            balance_manager,
            &proof,
            order_id,
            clock,
            ctx
        );
    }



    // === DEEP Tokenomics (Dual Yield) ===

    /// Auto-stake DEEP tokens to get maker rebates and fee discounts
    public fun stake_deep<BaseAsset, QuoteAsset>(
        proxy: &mut RiskProxy,
        pool: &mut Pool<BaseAsset, QuoteAsset>,
        balance_manager: &mut BalanceManager,
        amount: u64,
        ctx: &mut TxContext
    ) {
        assert!(tx_context::sender(ctx) == proxy.agent || tx_context::sender(ctx) == proxy.owner, ENotAuthorizedAgent);
        
        let proof = balance_manager::generate_proof_as_trader(balance_manager, &proxy.trade_cap, ctx);
        
        pool::stake(
            pool,
            balance_manager,
            &proof,
            amount,
            ctx
        );
    }

    /// Unstake DEEP tokens
    public fun unstake_deep<BaseAsset, QuoteAsset>(
        proxy: &mut RiskProxy,
        pool: &mut Pool<BaseAsset, QuoteAsset>,
        balance_manager: &mut BalanceManager,
        ctx: &mut TxContext
    ) {
        assert!(tx_context::sender(ctx) == proxy.agent || tx_context::sender(ctx) == proxy.owner, ENotAuthorizedAgent);
        
        let proof = balance_manager::generate_proof_as_trader(balance_manager, &proxy.trade_cap, ctx);
        
        pool::unstake(
            pool,
            balance_manager,
            &proof,
            ctx
        );
    }

    /// Claim accrued maker rebates (DEEP tokens)
    public fun claim_rebates<BaseAsset, QuoteAsset>(
        proxy: &mut RiskProxy,
        pool: &mut Pool<BaseAsset, QuoteAsset>,
        balance_manager: &mut BalanceManager,
        ctx: &mut TxContext
    ) {
        assert!(tx_context::sender(ctx) == proxy.agent || tx_context::sender(ctx) == proxy.owner, ENotAuthorizedAgent);
        
        let proof = balance_manager::generate_proof_as_trader(balance_manager, &proxy.trade_cap, ctx);
        
        pool::claim_rebates(
            pool,
            balance_manager,
            &proof,
            ctx
        );
    }
}
