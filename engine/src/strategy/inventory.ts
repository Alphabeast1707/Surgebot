// src/strategy/inventory.ts

export interface InventoryParams {
  maxPositionSize: number;
  baseQuoteSize: number;  // The standard size of an order in base asset
}

export interface AdjustedSizes {
  bidSize: number;
  askSize: number;
}

/**
 * Manages position sizes and scales down quotes as inventory limits are approached.
 */
export class InventoryManager {
  private maxPositionSize: number;
  private baseQuoteSize: number;
  private currentPosition: number;

  constructor(params: InventoryParams) {
    this.maxPositionSize = params.maxPositionSize;
    this.baseQuoteSize = params.baseQuoteSize;
    this.currentPosition = 0;
  }

  public updatePosition(newPosition: number): void {
    this.currentPosition = newPosition;
  }

  public getPosition(): number {
    return this.currentPosition;
  }

  /**
   * Scales quote sizes linearly down to 0 as the inventory approaches max bounds.
   * e.g., if we are very long (+q), we reduce bid size and increase/maintain ask size.
   */
  public calculateAdjustedSizes(): AdjustedSizes {
    // Math.abs(q) / maxPosition limits between 0 and 1
    const inventoryRatio = Math.min(Math.abs(this.currentPosition) / this.maxPositionSize, 1.0);
    
    let bidSize = this.baseQuoteSize;
    let askSize = this.baseQuoteSize;

    if (this.currentPosition > 0) {
      // Long position: scale down bids
      bidSize = this.baseQuoteSize * (1 - inventoryRatio);
    } else if (this.currentPosition < 0) {
      // Short position: scale down asks
      askSize = this.baseQuoteSize * (1 - inventoryRatio);
    }

    return {
      // Never quote less than 0
      bidSize: Math.max(bidSize, 0),
      askSize: Math.max(askSize, 0)
    };
  }
}
