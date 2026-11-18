import { sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { storeSettings } from "../db/schema";
import {
  sendError,
  sendValidationError,
  writeAudit,
} from "../lib/adminCatalog";
import { readStoreSettings } from "../lib/storeSettings";
import { requireAdmin, requireRole } from "../middleware/requireAdmin";

const PHONE_PATTERN = /^[\d\s+()-]{7,20}$/;

function jsonbValue(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

const settingsUpdateSchema = z
  .object({
    store_name: z
      .string()
      .trim()
      .min(1, "Store name is required.")
      .max(80, "Store name must be 80 characters or fewer."),
    phone: z
      .string()
      .trim()
      .refine(
        (value) => value === "" || PHONE_PATTERN.test(value),
        "Enter 7-20 characters using digits, spaces, +, ( ) or -.",
      ),
    email: z
      .string()
      .trim()
      .max(200, "Email must be 200 characters or fewer.")
      .refine(
        (value) =>
          value === "" || z.string().email().safeParse(value).success,
        "Enter a valid email address.",
      ),
    free_delivery_threshold_cents: z
      .number()
      .int("Enter a whole number of dollars.")
      .min(0, "The threshold cannot be negative.")
      .max(100000000, "The threshold is too large.")
      .nullable(),
    show_financing: z.boolean(),
    store_open: z.boolean(),
  })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Choose at least one setting to update.",
  );

export const adminSettingsRouter = Router();

adminSettingsRouter.use(requireAdmin);

adminSettingsRouter.get(
  "/settings",
  async (_req: Request, res: Response) => {
    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      res.json(await readStoreSettings(db));
    } catch (error) {
      sendError(res, error, "Failed to load store settings");
    }
  },
);

adminSettingsRouter.patch(
  "/settings",
  requireRole("owner"),
  async (req: Request, res: Response) => {
    const parsed = settingsUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const settings = parsed.data;

      await db.transaction(async (tx) => {
        const values: Array<{ key: string; value: unknown }> = [];

        if (settings.store_name !== undefined) {
          values.push({ key: "store_name", value: settings.store_name });
        }

        if (settings.phone !== undefined) {
          values.push({ key: "phone", value: settings.phone });
        }

        if (settings.email !== undefined) {
          values.push({ key: "email", value: settings.email });
        }

        if (settings.free_delivery_threshold_cents !== undefined) {
          values.push({
            key: "free_delivery_threshold_cents",
            value: settings.free_delivery_threshold_cents,
          });
        }

        if (settings.show_financing !== undefined) {
          values.push({
            key: "show_financing",
            value: settings.show_financing,
          });
        }

        if (settings.store_open !== undefined) {
          values.push({
            key: "store_open",
            value: settings.store_open,
          });
        }

        for (const item of values) {
          await tx
            .insert(storeSettings)
            .values({
              key: item.key,
              value: jsonbValue(item.value),
            })
            .onConflictDoUpdate({
              target: storeSettings.key,
              set: {
                value: jsonbValue(item.value),
                updatedAt: new Date(),
              },
            });
        }

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "settings.update",
          entity: "store_settings",
          entityId: null,
          details: {
            fields: Object.keys(settings),
            ...settings,
          },
        });
      });

      res.json(await readStoreSettings(db));
    } catch (error) {
      sendError(res, error, "Failed to update store settings");
    }
  },
);
