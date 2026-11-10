import { and, asc, eq, ne } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { deliveryZones } from "../db/schema";
import {
  HttpError,
  sendError,
  sendValidationError,
  writeAudit,
  type Executor,
} from "../lib/adminCatalog";
import { uncoveredZipRanges } from "../lib/zipCoverage";
import { requireAdmin, requireRole } from "../middleware/requireAdmin";

const zipSchema = z
  .string()
  .trim()
  .regex(/^\d{5}$/, "Enter a 5-digit ZIP code.");

const deliveryZoneCreateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Zone name is required.")
      .max(80, "Zone name must be 80 characters or fewer."),
    zip_start: zipSchema,
    zip_end: zipSchema,
    fee_cents: z
      .number()
      .int("Enter a whole dollar amount.")
      .min(0, "The delivery fee cannot be negative."),
    free_over_cents: z
      .number()
      .int("Enter a whole dollar amount.")
      .min(0, "The free-delivery amount cannot be negative.")
      .nullable(),
    is_active: z.boolean().optional(),
  })
  .refine((value) => value.zip_start <= value.zip_end, {
    message: "ZIP start must be less than or equal to ZIP end.",
    path: ["zip_end"],
  });

const deliveryZoneUpdateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Zone name is required.")
    .max(80, "Zone name must be 80 characters or fewer.")
    .optional(),
  zip_start: zipSchema.optional(),
  zip_end: zipSchema.optional(),
  fee_cents: z
    .number()
    .int("Enter a whole dollar amount.")
    .min(0, "The delivery fee cannot be negative.")
    .optional(),
  free_over_cents: z
    .number()
    .int("Enter a whole dollar amount.")
    .min(0, "The free-delivery amount cannot be negative.")
    .nullable()
    .optional(),
  is_active: z.boolean().optional(),
});

type DeliveryZoneRow = typeof deliveryZones.$inferSelect;

function serializeDeliveryZone(zone: DeliveryZoneRow) {
  return {
    id: zone.id,
    name: zone.name,
    zip_start: zone.zipStart,
    zip_end: zone.zipEnd,
    fee_cents: zone.feeCents,
    free_over_cents: zone.freeOverCents,
    is_active: zone.isActive,
    created_at: zone.createdAt,
    updated_at: zone.updatedAt,
  };
}

async function assertNoIdenticalActiveRange(
  executor: Executor,
  zipStart: string,
  zipEnd: string,
  isActive: boolean,
  excludeId?: string,
): Promise<void> {
  if (!isActive) {
    return;
  }

  const conditions = [
    eq(deliveryZones.isActive, true),
    eq(deliveryZones.zipStart, zipStart),
    eq(deliveryZones.zipEnd, zipEnd),
  ];

  if (excludeId) {
    conditions.push(ne(deliveryZones.id, excludeId));
  }

  const [duplicate] = await executor
    .select({ id: deliveryZones.id })
    .from(deliveryZones)
    .where(and(...conditions))
    .limit(1);

  if (duplicate) {
    throw new HttpError(
      409,
      "An active delivery zone already uses this exact ZIP range. Deactivate the other zone first or change this range.",
      {
        zip_end:
          "An active zone already uses this exact ZIP range.",
      },
    );
  }
}

export const adminDeliveryZonesRouter = Router();

adminDeliveryZonesRouter.use(requireAdmin);

adminDeliveryZonesRouter.get(
  "/delivery-zones",
  async (_req: Request, res: Response) => {
    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const rows = await db
        .select()
        .from(deliveryZones)
        .orderBy(asc(deliveryZones.name), asc(deliveryZones.zipStart));

      res.json(rows.map(serializeDeliveryZone));
    } catch (error) {
      sendError(res, error, "Failed to load delivery zones");
    }
  },
);

adminDeliveryZonesRouter.get(
  "/delivery-zones/coverage",
  async (_req: Request, res: Response) => {
    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const rows = await db
        .select({
          zipStart: deliveryZones.zipStart,
          zipEnd: deliveryZones.zipEnd,
          isActive: deliveryZones.isActive,
        })
        .from(deliveryZones);

      res.json({ ranges: uncoveredZipRanges(rows) });
    } catch (error) {
      sendError(res, error, "Failed to load ZIP coverage");
    }
  },
);

adminDeliveryZonesRouter.post(
  "/delivery-zones",
  requireRole("owner"),
  async (req: Request, res: Response) => {
    const parsed = deliveryZoneCreateSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const data = parsed.data;
      const isActive = data.is_active ?? true;

      const created = await db.transaction(async (tx) => {
        await assertNoIdenticalActiveRange(
          tx,
          data.zip_start,
          data.zip_end,
          isActive,
        );

        const [zone] = await tx
          .insert(deliveryZones)
          .values({
            name: data.name,
            zipStart: data.zip_start,
            zipEnd: data.zip_end,
            feeCents: data.fee_cents,
            freeOverCents: data.free_over_cents,
            isActive,
          })
          .returning();

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "delivery_zone.create",
          entity: "delivery_zone",
          entityId: zone.id,
          details: {
            fields: [
              "name",
              "zip_start",
              "zip_end",
              "fee_cents",
              "free_over_cents",
              "is_active",
            ],
          },
        });

        return zone;
      });

      res.status(201).json(serializeDeliveryZone(created));
    } catch (error) {
      sendError(res, error, "Failed to create delivery zone");
    }
  },
);

adminDeliveryZonesRouter.patch(
  "/delivery-zones/:id",
  requireRole("owner"),
  async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ error: "A valid delivery zone id is required." });
      return;
    }

    const parsed = deliveryZoneUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const updated = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(deliveryZones)
          .where(eq(deliveryZones.id, id.data))
          .limit(1);

        if (!existing) {
          throw new HttpError(404, "Delivery zone not found.");
        }

        const next = {
          name: parsed.data.name ?? existing.name,
          zipStart: parsed.data.zip_start ?? existing.zipStart,
          zipEnd: parsed.data.zip_end ?? existing.zipEnd,
          feeCents: parsed.data.fee_cents ?? existing.feeCents,
          freeOverCents:
            parsed.data.free_over_cents !== undefined
              ? parsed.data.free_over_cents
              : existing.freeOverCents,
          isActive: parsed.data.is_active ?? existing.isActive,
        };

        if (next.zipStart > next.zipEnd) {
          throw new HttpError(
            400,
            "Please check the highlighted fields.",
            {
              zip_end:
                "ZIP start must be less than or equal to ZIP end.",
            },
          );
        }

        await assertNoIdenticalActiveRange(
          tx,
          next.zipStart,
          next.zipEnd,
          next.isActive,
          existing.id,
        );

        const updates: Partial<typeof deliveryZones.$inferInsert> = {};
        const changed: string[] = [];

        if (next.name !== existing.name) {
          updates.name = next.name;
          changed.push("name");
        }
        if (next.zipStart !== existing.zipStart) {
          updates.zipStart = next.zipStart;
          changed.push("zip_start");
        }
        if (next.zipEnd !== existing.zipEnd) {
          updates.zipEnd = next.zipEnd;
          changed.push("zip_end");
        }
        if (next.feeCents !== existing.feeCents) {
          updates.feeCents = next.feeCents;
          changed.push("fee_cents");
        }
        if (next.freeOverCents !== existing.freeOverCents) {
          updates.freeOverCents = next.freeOverCents;
          changed.push("free_over_cents");
        }
        if (next.isActive !== existing.isActive) {
          updates.isActive = next.isActive;
          changed.push("is_active");
        }

        if (changed.length > 0) {
          updates.updatedAt = new Date();
          await tx
            .update(deliveryZones)
            .set(updates)
            .where(eq(deliveryZones.id, existing.id));
        }

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "delivery_zone.update",
          entity: "delivery_zone",
          entityId: existing.id,
          details: { fields: changed },
        });

        const [result] = await tx
          .select()
          .from(deliveryZones)
          .where(eq(deliveryZones.id, existing.id))
          .limit(1);

        return result;
      });

      res.json(serializeDeliveryZone(updated));
    } catch (error) {
      sendError(res, error, "Failed to update delivery zone");
    }
  },
);

adminDeliveryZonesRouter.delete(
  "/delivery-zones/:id",
  requireRole("owner"),
  async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ error: "A valid delivery zone id is required." });
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(deliveryZones)
          .where(eq(deliveryZones.id, id.data))
          .limit(1);

        if (!existing) {
          throw new HttpError(404, "Delivery zone not found.");
        }

        await tx
          .delete(deliveryZones)
          .where(eq(deliveryZones.id, existing.id));

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "delivery_zone.delete",
          entity: "delivery_zone",
          entityId: existing.id,
          details: { name: existing.name },
        });
      });

      res.json({ ok: true });
    } catch (error) {
      sendError(res, error, "Failed to delete delivery zone");
    }
  },
);
