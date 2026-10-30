import { applyRateFils, subtractFils, toFils, type Fils } from "@filspay/money";

/**
 * Estimates the platform fee for a capture amount given an MDR rate and
 * an optional promotional discount rate (both in basis points).
 */
export function estimateFeeFils(amountFils: number, mdrBps: number, discountBps = 0): number {
  const fils = toFils(amountFils);
  const discountedAmount = subtractFils(fils, applyRateFils(fils, discountBps));
  return applyRateFils(discountedAmount, mdrBps);
}
