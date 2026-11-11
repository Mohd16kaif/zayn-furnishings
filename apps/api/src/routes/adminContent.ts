import {
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  CONTENT_TYPE_LIMITS,
  containsFreeDeliveryToken,
  isContentType,
  isFreeDeliveryTokenAllowed,
  validateContentDateRange,
  validateContentLink,
} from "@zayn/shared";
import { and, asc, count, eq, inArray, ne } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contentBlocks, type ContentBlock } from "../db/schema";
import {
  HttpError,
  sendError,
  sendValidationError,
  writeAudit,
  type Executor,
} from "../lib/adminCatalog";
import {
  deleteImageObjects,
  detectImageType,
  processImage,
  singleImageUpload,
  singleImageUploadLimiter,
  uploadImageObject,
} from "../lib/imagePipeline";
import { requireAdmin } from "../middleware/requireAdmin";

const TOKEN_ERROR =
  "The free-delivery placeholder can only be used in an announcement title or subtitle.";

const dateValue = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "Enter a valid date.",
  );

const optionalDate = z.preprocess(
  (value) => (value === "" ? null : value),
  dateValue.nullable().optional(),
);

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .nullable()
    .optional();

const linkUrlField = z
  .string()
  .trim()
  .max(500, "Link must be 500 characters or fewer.")
  .nullable()
  .optional()
  .superRefine((value, context) => {
    const message = validateContentLink(value);

    if (message) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message,
      });
    }
  });

const contentCreateSchema = z.object({
  type: z.enum(CONTENT_TYPES),
  title: z
    .string()
    .trim()
    .min(1, "Title is required.")
    .max(120, "Title must be 120 characters or fewer."),
  subtitle: optionalText(200, "Subtitle"),
  body: optionalText(2000, "Body"),
  button_text: optionalText(40, "Button text"),
  link_url: linkUrlField,
  starts_at: optionalDate,
  ends_at: optionalDate,
  sort_order: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
});

const contentUpdateSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title is required.")
      .max(120, "Title must be 120 characters or fewer.")
      .optional(),
    subtitle: optionalText(200, "Subtitle"),
    body: optionalText(2000, "Body"),
    button_text: optionalText(40, "Button text"),
    link_url: linkUrlField,
    starts_at: optionalDate,
    ends_at: optionalDate,
    sort_order: z.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Choose at least one field to update.",
  });

const reorderSchema = z
  .array(
    z.object({
      id: z.string().uuid(),
      sort_order: z.number().int().min(0),
    }),
  )
  .min(1)
  .max(200);

const listQuerySchema = z.object({
  type: z.enum(CONTENT_TYPES).optional(),
});

function serializeContentBlock(block: ContentBlock) {
  return {
    id: block.id,
    type: block.type,
    title: block.title,
    subtitle: block.subtitle,
    body: block.body,
    image_url: block.imageUrl,
    storage_path: block.storagePath,
    button_text: block.buttonText,
    link_url: block.linkUrl,
    sort_order: block.sortOrder,
    starts_at: block.startsAt,
    ends_at: block.endsAt,
    is_active: block.isActive,
    created_at: block.createdAt,
    updated_at: block.updatedAt,
  };
}

function parseDate(
  value: string | null | undefined,
): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  return new Date(value);
}

function assertTokensAllowed(
  type: string,
  values: Record<string, string | null | undefined>,
): void {
  for (const [field, value] of Object.entries(values)) {
    if (
      containsFreeDeliveryToken(value) &&
      !isFreeDeliveryTokenAllowed(type, field)
    ) {
      throw new HttpError(400, TOKEN_ERROR, {
        [field]: TOKEN_ERROR,
      });
    }
  }
}

function assertDateRange(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined,
): void {
  const message = validateContentDateRange(startsAt, endsAt);

  if (message) {
    throw new HttpError(400, message, { ends_at: message });
  }
}

function assertHeroImage(
  type: string,
  isActive: boolean,
  imageUrl: string | null,
): void {
  if (type === "hero" && isActive && !imageUrl) {
    const message = "Upload a hero image before making it active.";
    throw new HttpError(400, message, { is_active: message });
  }
}

async function assertActiveLimit(
  executor: Executor,
  type: (typeof CONTENT_TYPES)[number],
  excludeId?: string,
): Promise<void> {
  const conditions = [
    eq(contentBlocks.type, type),
    eq(contentBlocks.isActive, true),
  ];

  if (excludeId) {
    conditions.push(ne(contentBlocks.id, excludeId));
  }

  const [row] = await executor
    .select({ value: count() })
    .from(contentBlocks)
    .where(and(...conditions));

  const total = Number(row?.value ?? 0);
  const limit = CONTENT_TYPE_LIMITS[type];

  if (total >= limit) {
    throw new HttpError(
      409,
      `You can have up to ${limit} active ${CONTENT_TYPE_LABELS[type]} blocks. Deactivate another one first.`,
    );
  }
}

async function findContentBlock(
  executor: Executor,
  id: string,
  lock = false,
) {
  const query = executor
    .select()
    .from(contentBlocks)
    .where(
      and(
        eq(contentBlocks.id, id),
        inArray(contentBlocks.type, [...CONTENT_TYPES]),
      ),
    )
    .limit(1);

  const [block] = lock ? await query.for("update") : await query;

  return block ?? null;
}

export const adminContentRouter = Router();

adminContentRouter.use(requireAdmin);

adminContentRouter.get(
  "/content",
  async (req: Request, res: Response) => {
    const parsed = listQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const conditions = [
        inArray(contentBlocks.type, [...CONTENT_TYPES]),
      ];

      if (parsed.data.type) {
        conditions.push(eq(contentBlocks.type, parsed.data.type));
      }

      const rows = await db
        .select()
        .from(contentBlocks)
        .where(and(...conditions))
        .orderBy(
          asc(contentBlocks.type),
          asc(contentBlocks.sortOrder),
          asc(contentBlocks.createdAt),
        );

      res.json(rows.map(serializeContentBlock));
    } catch (error) {
      sendError(res, error, "Failed to load content blocks");
    }
  },
);

adminContentRouter.post(
  "/content",
  async (req: Request, res: Response) => {
    const parsed = contentCreateSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const created = await db.transaction(async (tx) => {
        const data = parsed.data;
        const isActive = data.is_active ?? data.type !== "hero";
        const startsAt = parseDate(data.starts_at) ?? null;
        const endsAt = parseDate(data.ends_at) ?? null;

        assertTokensAllowed(data.type, {
          title: data.title,
          subtitle: data.subtitle,
          body: data.body,
          button_text: data.button_text,
          link_url: data.link_url,
        });
        assertDateRange(startsAt, endsAt);
        assertHeroImage(data.type, isActive, null);

        if (isActive) {
          await assertActiveLimit(tx, data.type);
        }

        const [block] = await tx
          .insert(contentBlocks)
          .values({
            type: data.type,
            title: data.title,
            subtitle: data.subtitle ?? null,
            body: data.body ?? null,
            buttonText: data.button_text ?? null,
            linkUrl: data.link_url ?? null,
            sortOrder: data.sort_order ?? 0,
            startsAt,
            endsAt,
            isActive,
          })
          .returning();

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "content.create",
          entity: "content_block",
          entityId: block.id,
          details: { type: block.type, fields: Object.keys(data) },
        });

        return block;
      });

      res.status(201).json(serializeContentBlock(created));
    } catch (error) {
      sendError(res, error, "Failed to create content block");
    }
  },
);

adminContentRouter.post(
  "/content/reorder",
  async (req: Request, res: Response) => {
    const parsed = reorderSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const ids = parsed.data.map((item) => item.id);

    if (new Set(ids).size !== ids.length) {
      res.status(400).json({ error: "Each content block can only appear once." });
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      await db.transaction(async (tx) => {
        const rows = await tx
          .select({ id: contentBlocks.id, type: contentBlocks.type })
          .from(contentBlocks)
          .where(inArray(contentBlocks.id, ids));

        if (rows.length !== ids.length) {
          throw new HttpError(
            404,
            "One or more content blocks could not be found.",
          );
        }

        const types = new Set(rows.map((row) => row.type));

        if (types.size !== 1) {
          throw new HttpError(
            400,
            "Content blocks must all be the same type to reorder.",
          );
        }

        const [type] = types;

        if (!isContentType(type)) {
          throw new HttpError(400, "That content type cannot be reordered.");
        }

        for (const item of parsed.data) {
          await tx
            .update(contentBlocks)
            .set({ sortOrder: item.sort_order, updatedAt: new Date() })
            .where(eq(contentBlocks.id, item.id));

          await writeAudit(tx, {
            adminUserId: req.admin!.id,
            action: "content.reorder",
            entity: "content_block",
            entityId: item.id,
            details: {
              type,
              fields: ["sort_order"],
              sort_order: item.sort_order,
            },
          });
        }
      });

      res.json({ ok: true });
    } catch (error) {
      sendError(res, error, "Failed to reorder content blocks");
    }
  },
);

adminContentRouter.patch(
  "/content/:id",
  async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ error: "A valid content block id is required." });
      return;
    }

    const parsed = contentUpdateSchema.safeParse(req.body);

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
        const existing = await findContentBlock(tx, id.data, true);

        if (!existing) {
          throw new HttpError(404, "Content block not found.");
        }

        const data = parsed.data;
        const nextTitle = data.title ?? existing.title;

        if (!nextTitle) {
          throw new HttpError(400, "Title is required.", {
            title: "Title is required.",
          });
        }

        const nextIsActive = data.is_active ?? existing.isActive;
        const nextStartsAt =
          data.starts_at !== undefined
            ? parseDate(data.starts_at)
            : existing.startsAt;
        const nextEndsAt =
          data.ends_at !== undefined
            ? parseDate(data.ends_at)
            : existing.endsAt;

        assertTokensAllowed(existing.type, {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.subtitle !== undefined
            ? { subtitle: data.subtitle }
            : {}),
          ...(data.body !== undefined ? { body: data.body } : {}),
          ...(data.button_text !== undefined
            ? { button_text: data.button_text }
            : {}),
          ...(data.link_url !== undefined
            ? { link_url: data.link_url }
            : {}),
        });
        assertDateRange(nextStartsAt, nextEndsAt);
        assertHeroImage(
          existing.type,
          nextIsActive,
          existing.imageUrl,
        );

        if (nextIsActive && !existing.isActive) {
          if (!isContentType(existing.type)) {
            throw new HttpError(404, "Content block not found.");
          }

          await assertActiveLimit(tx, existing.type, existing.id);
        }

        const updates: Partial<typeof contentBlocks.$inferInsert> = {};
        const changed: string[] = [];

        if (data.title !== undefined && data.title !== existing.title) {
          updates.title = data.title;
          changed.push("title");
        }

        if (
          data.subtitle !== undefined &&
          data.subtitle !== existing.subtitle
        ) {
          updates.subtitle = data.subtitle;
          changed.push("subtitle");
        }

        if (data.body !== undefined && data.body !== existing.body) {
          updates.body = data.body;
          changed.push("body");
        }

        if (
          data.button_text !== undefined &&
          data.button_text !== existing.buttonText
        ) {
          updates.buttonText = data.button_text;
          changed.push("button_text");
        }

        if (
          data.link_url !== undefined &&
          data.link_url !== existing.linkUrl
        ) {
          updates.linkUrl = data.link_url;
          changed.push("link_url");
        }

        if (
          data.starts_at !== undefined &&
          nextStartsAt?.getTime() !== existing.startsAt?.getTime()
        ) {
          updates.startsAt = nextStartsAt;
          changed.push("starts_at");
        }

        if (
          data.ends_at !== undefined &&
          nextEndsAt?.getTime() !== existing.endsAt?.getTime()
        ) {
          updates.endsAt = nextEndsAt;
          changed.push("ends_at");
        }

        if (
          data.sort_order !== undefined &&
          data.sort_order !== existing.sortOrder
        ) {
          updates.sortOrder = data.sort_order;
          changed.push("sort_order");
        }

        if (
          data.is_active !== undefined &&
          data.is_active !== existing.isActive
        ) {
          updates.isActive = data.is_active;
          changed.push("is_active");
        }

        if (changed.length > 0) {
          updates.updatedAt = new Date();
          await tx
            .update(contentBlocks)
            .set(updates)
            .where(eq(contentBlocks.id, existing.id));
        }

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "content.update",
          entity: "content_block",
          entityId: existing.id,
          details: { type: existing.type, fields: changed },
        });

        const [block] = await tx
          .select()
          .from(contentBlocks)
          .where(eq(contentBlocks.id, existing.id))
          .limit(1);

        return block;
      });

      res.json(serializeContentBlock(updated));
    } catch (error) {
      sendError(res, error, "Failed to update content block");
    }
  },
);

adminContentRouter.delete(
  "/content/:id",
  async (req: Request, res: Response) => {
    if (req.admin?.role !== "owner") {
      res
        .status(403)
        .json({ error: "Only the owner can delete content blocks." });
      return;
    }

    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ error: "A valid content block id is required." });
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      let storagePath: string | null = null;

      await db.transaction(async (tx) => {
        const existing = await findContentBlock(tx, id.data);

        if (!existing) {
          throw new HttpError(404, "Content block not found.");
        }

        storagePath = existing.storagePath;

        await tx
          .delete(contentBlocks)
          .where(eq(contentBlocks.id, existing.id));

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "content.delete",
          entity: "content_block",
          entityId: existing.id,
          details: { type: existing.type },
        });
      });

      if (storagePath) {
        await deleteImageObjects(
          [storagePath],
          "content image objects",
        );
      }

      res.json({ ok: true });
    } catch (error) {
      sendError(res, error, "Failed to delete content block");
    }
  },
);

adminContentRouter.post(
  "/content/:id/image",
  singleImageUploadLimiter,
  singleImageUpload,
  async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ error: "A valid content block id is required." });
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const file = files[0];

    if (!file) {
      res.status(400).json({ error: "Choose an image to upload." });
      return;
    }

    try {
      const existing = await findContentBlock(db, id.data);

      if (!existing) {
        res.status(404).json({ error: "Content block not found." });
        return;
      }

      if (!detectImageType(file.buffer)) {
        res.status(400).json({
          error: `"${file.originalname}" is not a JPG, PNG, or WebP image.`,
        });
        return;
      }

      let processed: Buffer;

      try {
        processed = await processImage(file.buffer, {
          width: existing.type === "hero" ? 2400 : 1200,
        });
      } catch {
        throw new HttpError(
          400,
          `"${file.originalname}" could not be processed as an image. Please try a different file.`,
        );
      }

      const uploaded = await uploadImageObject({
        folder: "content",
        ownerId: existing.id,
        buffer: processed,
        errorMessage:
          "We could not save the image. Please try again.",
      });

      try {
        const result = await db.transaction(async (tx) => {
          const locked = await findContentBlock(tx, existing.id, true);

          if (!locked) {
            throw new HttpError(404, "Content block not found.");
          }

          const previousPath = locked.storagePath;

          await tx
            .update(contentBlocks)
            .set({
              imageUrl: uploaded.url,
              storagePath: uploaded.path,
              updatedAt: new Date(),
            })
            .where(eq(contentBlocks.id, locked.id));

          await writeAudit(tx, {
            adminUserId: req.admin!.id,
            action: "content.image.add",
            entity: "content_block",
            entityId: locked.id,
            details: { type: locked.type },
          });

          const [block] = await tx
            .select()
            .from(contentBlocks)
            .where(eq(contentBlocks.id, locked.id))
            .limit(1);

          return { block, previousPath };
        });

        if (
          result.previousPath &&
          result.previousPath !== uploaded.path
        ) {
          await deleteImageObjects(
            [result.previousPath],
            "content image objects",
          );
        }

        res.status(201).json(serializeContentBlock(result.block));
      } catch (error) {
        await deleteImageObjects(
          [uploaded.path],
          "content image objects",
        );
        throw error;
      }
    } catch (error) {
      sendError(res, error, "Failed to upload content image");
    }
  },
);

adminContentRouter.delete(
  "/content/:id/image",
  async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ error: "A valid content block id is required." });
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      let removedPath: string | null = null;

      const updated = await db.transaction(async (tx) => {
        const existing = await findContentBlock(tx, id.data, true);

        if (!existing) {
          throw new HttpError(404, "Content block not found.");
        }

        if (!existing.imageUrl && !existing.storagePath) {
          throw new HttpError(404, "This content block has no image.");
        }

        if (existing.type === "hero" && existing.isActive) {
          throw new HttpError(
            409,
            "Deactivate this hero before removing its image.",
          );
        }

        removedPath = existing.storagePath;

        await tx
          .update(contentBlocks)
          .set({
            imageUrl: null,
            storagePath: null,
            updatedAt: new Date(),
          })
          .where(eq(contentBlocks.id, existing.id));

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "content.image.delete",
          entity: "content_block",
          entityId: existing.id,
          details: { type: existing.type },
        });

        const [block] = await tx
          .select()
          .from(contentBlocks)
          .where(eq(contentBlocks.id, existing.id))
          .limit(1);

        return block;
      });

      if (removedPath) {
        await deleteImageObjects(
          [removedPath],
          "content image objects",
        );
      }

      res.json(serializeContentBlock(updated));
    } catch (error) {
      sendError(res, error, "Failed to delete content image");
    }
  },
);
