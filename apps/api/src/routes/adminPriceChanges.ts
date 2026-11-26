import { Router, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { describeBulkPriceChange } from "@zayn/shared";
import { env } from "../config/env";
import { db } from "../db/client";
import { sendError, sendValidationError } from "../lib/adminCatalog";
import {
  applyPriceChange,
  getPriceChangeBatch,
  listPriceChangeBatches,
  priceChangeParamsSchema,
  previewPriceChange,
  serializePriceChangeRow,
  undoPriceChangeBatch,
} from "../lib/priceChanges";
import { signPriceChangePreview } from "../lib/priceChangeToken";
import {
  requireAdmin,
  requireRole,
} from "../middleware/requireAdmin";

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const PREVIEW_RATE_LIMIT = 60;
const WRITE_RATE_LIMIT = 20;
const READ_RATE_LIMIT = 120;

const RATE_LIMIT_MESSAGE = {
  error: "Too many price change requests. Please wait a few minutes and try again.",
};

function adminKey(req: Request): string {
  return req.admin?.id ?? ipKeyGenerator(req.ip ?? "");
}

const previewRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: PREVIEW_RATE_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: adminKey,
  message: RATE_LIMIT_MESSAGE,
});

const writeRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: WRITE_RATE_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: adminKey,
  message: RATE_LIMIT_MESSAGE,
});

const readRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: READ_RATE_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: adminKey,
  message: RATE_LIMIT_MESSAGE,
});

const applySchema = z
  .object({
    params: priceChangeParamsSchema,
    preview_token: z
      .string()
      .trim()
      .min(1, "Preview the change again before applying."),
  })
  .strict();

export const adminPriceChangesRouter = Router();

adminPriceChangesRouter.use(requireAdmin);
adminPriceChangesRouter.use(requireRole("owner"));

adminPriceChangesRouter.post(
  "/price-changes/preview",
  previewRateLimiter,
  async (req: Request, res: Response) => {
    const parsed = priceChangeParamsSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const preview = await previewPriceChange(db, parsed.data);
      const previewToken = signPriceChangePreview({
        params: parsed.data,
        okRows: preview.rows.filter((row) => row.status === "ok"),
        secret: env.ADMIN_AUTH_SECRET,
      });

      res.json({
        rows: preview.rows.map(serializePriceChangeRow),
        counts: preview.counts,
        totals: preview.totals,
        preview_token: previewToken,
      });
    } catch (error) {
      sendError(res, error, "Failed to preview price changes");
    }
  },
);

adminPriceChangesRouter.post(
  "/price-changes/apply",
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const parsed = applySchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const result = await applyPriceChange(db, {
        adminId: req.admin!.id,
        params: parsed.data.params,
        previewToken: parsed.data.preview_token,
        secret: env.ADMIN_AUTH_SECRET,
      });

      res.json({
        id: result.batch.id,
        created_at: result.batch.createdAt,
        item_count: result.batch.itemCount,
        undone_at: result.batch.undoneAt,
        counts: result.counts,
        totals: result.totals,
        summary: describeBulkPriceChange(result.params),
      });
    } catch (error) {
      sendError(res, error, "Failed to apply price changes");
    }
  },
);

adminPriceChangesRouter.get(
  "/price-changes",
  readRateLimiter,
  async (_req: Request, res: Response) => {
    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      res.json(await listPriceChangeBatches(db));
    } catch (error) {
      sendError(res, error, "Failed to load price changes");
    }
  },
);

adminPriceChangesRouter.get(
  "/price-changes/:id",
  readRateLimiter,
  async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ error: "A valid price change id is required." });
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      res.json(await getPriceChangeBatch(db, id.data));
    } catch (error) {
      sendError(res, error, "Failed to load the price change");
    }
  },
);

adminPriceChangesRouter.post(
  "/price-changes/:id/undo",
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ error: "A valid price change id is required." });
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      res.json(
        await undoPriceChangeBatch(db, {
          adminId: req.admin!.id,
          batchId: id.data,
        }),
      );
    } catch (error) {
      sendError(res, error, "Failed to undo the price change");
    }
  },
);
