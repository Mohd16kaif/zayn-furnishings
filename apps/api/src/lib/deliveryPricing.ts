import { and, eq, gte, lte } from "drizzle-orm";
import { computeDelivery } from "@zayn/shared";
import { deliveryZones } from "../db/schema";
import type { Executor } from "./adminCatalog";
import { readStoreSettings } from "./storeSettings";

export type DeliveryZoneRow = typeof deliveryZones.$inferSelect;

export async function findBestDeliveryZone(
  executor: Executor,
  zip: string,
): Promise<DeliveryZoneRow | null> {
  const zones = await executor
    .select()
    .from(deliveryZones)
    .where(
      and(
        eq(deliveryZones.isActive, true),
        lte(deliveryZones.zipStart, zip),
        gte(deliveryZones.zipEnd, zip),
      ),
    );

  if (zones.length === 0) {
    return null;
  }

  return zones.reduce((current, zone) => {
    const currentSpan = Number(current.zipEnd) - Number(current.zipStart);
    const zoneSpan = Number(zone.zipEnd) - Number(zone.zipStart);

    return zoneSpan < currentSpan ? zone : current;
  });
}

export async function computeDeliveryQuote(
  executor: Executor,
  zip: string,
  subtotalCents: number,
) {
  const zone = await findBestDeliveryZone(executor, zip);

  if (!zone) {
    return {
      zone: null,
      computation: computeDelivery({
        zone: null,
        settingsThresholdCents: null,
        subtotalCents,
      }),
    };
  }

  const settings = await readStoreSettings(executor);
  const computation = computeDelivery({
    zone: {
      feeCents: zone.feeCents,
      freeOverCents: zone.freeOverCents,
    },
    settingsThresholdCents: settings.free_delivery_threshold_cents,
    subtotalCents,
  });

  return { zone, computation };
}
