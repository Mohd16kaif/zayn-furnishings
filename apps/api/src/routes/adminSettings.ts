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

const settingsUpdateSchema = z.object({
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
});

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
        const values: Array<{ key: string; value: unknown }> = [
          { key: "store_name", value: settings.store_name },
          { key: "phone", value: settings.phone },
          { key: "email", value: settings.email },
          {
            key: "free_delivery_threshold_cents",
            value: settings.free_delivery_threshold_cents,
          },
          {
            key: "show_financing",
            value: settings.show_financing,
          },
        ];

        for (const item of values) {
          await tx
            .insert(storeSettings)
            .values({ key: item.key, value: item.value })
            .onConflictDoUpdate({
              target: storeSettings.key,
              set: { value: item.value, updatedAt: new Date() },
            });
        }

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "settings.update",
          entity: "store_settings",
          entityId: null,
          details: {
            fields: Object.keys(settings),
            free_delivery_threshold_cents:
              settings.free_delivery_threshold_cents,
            show_financing: settings.show_financing,
          },
        });
      });

      res.json(await readStoreSettings(db));
    } catch (error) {
      sendError(res, error, "Failed to update store settings");
    }
  },
);
