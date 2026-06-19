// src/strategy/volatility.ts

/**
 * Exponentially Weighted Moving Average (EWMA) volatility estimator.
 * Used by the Avellaneda-Stoikov model to adapt spreads to changing market conditions.
 */
export class VolatilityEstimator {
  private lambda: number;
  private currentVariance: number;
  private lastPrice: number | null;

  /**
   * @param lambda Decay factor (0 < lambda < 1). e.g., 0.94 for daily, 0.99 for high frequency.
   */
  constructor(lambda: number = 0.94) {
    this.lambda = lambda;
    this.currentVariance = 0;
    this.lastPrice = null;
  }

  /**
   * Update the estimator with a new price observation.
   * Calculates log return and updates the EWMA variance.
   */
  public update(price: number): void {
    if (this.lastPrice === null) {
      this.lastPrice = price;
      // Initialize with a small baseline variance rather than 0
      this.currentVariance = 0.0001; 
      return;
    }

    // Log return: r_t = ln(P_t / P_{t-1})
    const logReturn = Math.log(price / this.lastPrice);
    
    // EWMA Variance: σ²_t = λ * σ²_{t-1} + (1 - λ) * r_t²
    this.currentVariance = (this.lambda * this.currentVariance) + 
                          ((1 - this.lambda) * Math.pow(logReturn, 2));

    this.lastPrice = price;
  }

  /**
   * Gets the current estimated volatility (standard deviation).
   */
  public getVolatility(): number {
    return Math.sqrt(this.currentVariance);
  }

  /**
   * Gets the current variance (σ²).
   */
  public getVariance(): number {
    return this.currentVariance;
  }
}
