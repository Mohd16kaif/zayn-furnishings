export interface DeliveryZoneInput {
  feeCents: number;
  freeOverCents: number | null;
}

export interface ComputeDeliveryInput {
  zone: DeliveryZoneInput | null;
  settingsThresholdCents: number | null;
  subtotalCents: number;
}

export interface DeliveryComputation {
  feeCents: number;
  isFree: boolean;
  freeOverCents: number | null;
  amountToFreeCents: number | null;
}

/**
 * Single source of truth for delivery pricing.
 *
 * Precedence:
 * 1. zone.freeOverCents when it is not null
 * 2. settingsThresholdCents
 * 3. no free-delivery threshold
 *
 * The zone fee is charged unless the order qualifies as free (by threshold
 * or because the zone fee itself is zero). Callers decide availability
 * separately; a null zone means no delivery fee is known.
 */
export function computeDelivery({
  zone,
  settingsThresholdCents,
  subtotalCents,
}: ComputeDeliveryInput): DeliveryComputation {
  const subtotal = Number.isFinite(subtotalCents)
    ? Math.max(0, Math.round(subtotalCents))
    : 0;
  const threshold =
    zone?.freeOverCents ?? settingsThresholdCents ?? null;
  const baseFee = zone?.feeCents ?? 0;
  const qualifiesByThreshold =
    threshold !== null && subtotal >= threshold;
  const isFree =
    zone !== null && (baseFee === 0 || qualifiesByThreshold);
  const feeCents = isFree ? 0 : baseFee;
  const amountToFreeCents = isFree
    ? 0
    : threshold !== null
      ? Math.max(0, threshold - subtotal)
      : null;

  return {
    feeCents,
    isFree,
    freeOverCents: threshold,
    amountToFreeCents,
  };
}
