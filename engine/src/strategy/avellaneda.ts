// src/strategy/avellaneda.ts
import BigNumber from 'bignumber.js';

export interface AvellanedaParams {
  midPrice: number;
  inventory: number;
  riskAversion: number; // Gamma (γ)
  volatility: number;   // Sigma (σ)
  timeHorizon: number;  // T - t
  orderArrivalRate: number; // k
}

export interface QuotePrices {
  reservationPrice: number;
  optimalSpread: number;
  bidPrice: number;
  askPrice: number;
}

/**
 * Implements the Avellaneda-Stoikov model for optimal market making.
 */
export class AvellanedaStoikov {
  
  /**
   * Calculates the reservation price (inventory-adjusted fair value).
   * r(s, q, t) = s - q * γ * σ² * (T - t)
   */
  public static calculateReservationPrice(params: AvellanedaParams): number {
    const { midPrice, inventory, riskAversion, volatility, timeHorizon } = params;
    
    const inventoryAdjustment = inventory * riskAversion * Math.pow(volatility, 2) * timeHorizon;
    return midPrice - inventoryAdjustment;
  }

  /**
   * Calculates the optimal spread around the reservation price.
   * δ(γ, σ, T, t, k) = γ * σ² * (T - t) + (2 / γ) * ln(1 + γ / k)
   */
  public static calculateOptimalSpread(params: AvellanedaParams): number {
    const { riskAversion, volatility, timeHorizon, orderArrivalRate } = params;
    
    // Fallbacks for zero/edge cases to prevent NaN
    if (riskAversion === 0) return 0;
    const k = orderArrivalRate <= 0 ? 0.0001 : orderArrivalRate;

    const term1 = riskAversion * Math.pow(volatility, 2) * timeHorizon;
    const term2 = (2 / riskAversion) * Math.log(1 + (riskAversion / k));
    
    return term1 + term2;
  }

  /**
   * Computes the final bid and ask prices to quote.
   */
  public static calculateQuotes(params: AvellanedaParams): QuotePrices {
    const reservationPrice = this.calculateReservationPrice(params);
    const optimalSpread = this.calculateOptimalSpread(params);

    // Apply minimum tick size rounding in actual implementation,
    // but keep exact numbers here for the pure math model.
    return {
      reservationPrice,
      optimalSpread,
      bidPrice: reservationPrice - (optimalSpread / 2),
      askPrice: reservationPrice + (optimalSpread / 2)
    };
  }
}
