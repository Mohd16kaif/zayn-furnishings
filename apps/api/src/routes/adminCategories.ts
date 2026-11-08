import { asc, count, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { categories, products, type Category } from "../db/schema";
import {
  HttpError,
  assertCategorySlugAvailable,
  sendError,
  sendValidationError,
  slugify,
  uniqueCategorySlug,
  writeAudit,
  type Executor,
} from "../lib/adminCatalog";
import { requireAdmin } from "../middleware/requireAdmin";

const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(160),
  parent_id: z.string().uuid("Choose a valid parent category.").nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  is_active: z.boolean().optional(),
  seo_title: z.string().trim().max(200).nullable().optional(),
  seo_description: z.string().trim().max(500).nullable().optional(),
});

const categoryUpdateSchema = categoryCreateSchema
  .partial()
  .extend({ slug: z.string().trim().min(1).max(160).optional() });

const reorderSchema = z
  .array(
    z.object({
      id: z.string().uuid(),
      sort_order: z.number().int().min(0),
    }),
  )
  .min(1)
  .max(500);

function serializeCategory(category: Category, productCount: number) {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    parent_id: category.parentId,
    image_url: category.imageUrl,
    description: category.description,
    sort_order: category.sortOrder,
    is_active: category.isActive,
    seo_title: category.seoTitle,
    seo_description: category.seoDescription,
    product_count: productCount,
  };
}

async function validateParent(
  executor: Executor,
  parentId: string | null,
  selfId?: string,
): Promise<void> {
  if (!parentId) {
    return;
  }

  if (selfId && parentId === selfId) {
    throw new HttpError(400, "A category cannot be its own parent.", {
      parent_id: "A category cannot be its own parent.",
    });
  }

  const [parent] = await executor
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .where(eq(categories.id, parentId))
    .limit(1);

  if (!parent) {
    throw new HttpError(400, "The selected parent category was not found.", {
      parent_id: "The selected parent category was not found.",
    });
  }

  if (parent.parentId) {
    throw new HttpError(
      400,
      "Categories can only be nested two levels deep. Choose a top-level parent.",
      {
        parent_id:
          "Choose a top-level category. Subcategories cannot have their own subcategories.",
      },
    );
  }

  if (selfId) {
    const [child] = await executor
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.parentId, selfId))
      .limit(1);

    if (child) {
      throw new HttpError(
        400,
        "This category has subcategories. Move them out before making it a subcategory.",
        {
          parent_id:
            "This category has subcategories. Move them out before making it a subcategory.",
        },
      );
    }
  }
}

export const adminCategoriesRouter = Router();

adminCategoriesRouter.use(requireAdmin);

adminCategoriesRouter.get(
  "/categories",
  async (_req: Request, res: Response) => {
    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const rows = await db
        .select()
        .from(categories)
        .orderBy(asc(categories.sortOrder), asc(categories.name));

      const counts = await db
        .select({ categoryId: products.categoryId, value: count() })
        .from(products)
        .groupBy(products.categoryId);

      const countByCategory = new Map(
        counts.map((row) => [row.categoryId, Number(row.value)]),
      );

      res.json(
        rows.map((category) =>
          serializeCategory(
            category,
            countByCategory.get(category.id) ?? 0,
          ),
        ),
      );
    } catch (error) {
      sendError(res, error, "Failed to load categories");
    }
  },
);

adminCategoriesRouter.post(
  "/categories",
  async (req: Request, res: Response) => {
    const parsed = categoryCreateSchema.safeParse(req.body);

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
        const parentId = parsed.data.parent_id ?? null;
        await validateParent(tx, parentId);

        const slug = await uniqueCategorySlug(tx, parsed.data.name);

        const [category] = await tx
          .insert(categories)
          .values({
            name: parsed.data.name,
            slug,
            parentId,
            description: parsed.data.description ?? null,
            isActive: parsed.data.is_active ?? true,
            seoTitle: parsed.data.seo_title ?? null,
            seoDescription: parsed.data.seo_description ?? null,
          })
          .returning();

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "category.create",
          entity: "category",
          entityId: category.id,
          details: {
            fields: [
              "name",
              "slug",
              "parent_id",
              "description",
              "is_active",
              "seo_title",
              "seo_description",
            ],
          },
        });

        return category;
      });

      res.status(201).json(serializeCategory(created, 0));
    } catch (error) {
      sendError(res, error, "Failed to create category");
    }
  },
);

adminCategoriesRouter.patch(
  "/categories/reorder",
  async (req: Request, res: Response) => {
    const parsed = reorderSchema.safeParse(req.body);

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      await db.transaction(async (tx) => {
        for (const item of parsed.data) {
          const [updated] = await tx
            .update(categories)
            .set({ sortOrder: item.sort_order, updatedAt: new Date() })
            .where(eq(categories.id, item.id))
            .returning({ id: categories.id });

          if (!updated) {
            throw new HttpError(
              404,
              "One of the categories could not be found.",
            );
          }

          await writeAudit(tx, {
            adminUserId: req.admin!.id,
            action: "category.reorder",
            entity: "category",
            entityId: item.id,
            details: { fields: ["sort_order"], sort_order: item.sort_order },
          });
        }
      });

      res.json({ ok: true });
    } catch (error) {
      sendError(res, error, "Failed to reorder categories");
    }
  },
);

adminCategoriesRouter.patch(
  "/categories/:id",
  async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ error: "A valid category id is required." });
      return;
    }

    const parsed = categoryUpdateSchema.safeParse(req.body);

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
          .from(categories)
          .where(eq(categories.id, id.data))
          .limit(1);

        if (!existing) {
          throw new HttpError(404, "Category not found.");
        }

        if (parsed.data.parent_id !== undefined) {
          await validateParent(tx, parsed.data.parent_id, existing.id);
        }

        const updates: Partial<typeof categories.$inferInsert> = {};
        const changed: string[] = [];

        if (parsed.data.name !== undefined && parsed.data.name !== existing.name) {
          updates.name = parsed.data.name;
          changed.push("name");
        }

        if (parsed.data.slug !== undefined) {
          const nextSlug = slugify(parsed.data.slug);
          if (nextSlug !== existing.slug) {
            await assertCategorySlugAvailable(tx, nextSlug, existing.id);
            updates.slug = nextSlug;
            changed.push("slug");
          }
        }

        if (
          parsed.data.parent_id !== undefined &&
          parsed.data.parent_id !== existing.parentId
        ) {
          updates.parentId = parsed.data.parent_id;
          changed.push("parent_id");
        }

        if (
          parsed.data.description !== undefined &&
          parsed.data.description !== existing.description
        ) {
          updates.description = parsed.data.description;
          changed.push("description");
        }

        if (
          parsed.data.is_active !== undefined &&
          parsed.data.is_active !== existing.isActive
        ) {
          updates.isActive = parsed.data.is_active;
          changed.push("is_active");
        }

        if (
          parsed.data.seo_title !== undefined &&
          parsed.data.seo_title !== existing.seoTitle
        ) {
          updates.seoTitle = parsed.data.seo_title;
          changed.push("seo_title");
        }

        if (
          parsed.data.seo_description !== undefined &&
          parsed.data.seo_description !== existing.seoDescription
        ) {
          updates.seoDescription = parsed.data.seo_description;
          changed.push("seo_description");
        }

        if (changed.length > 0) {
          updates.updatedAt = new Date();
          await tx
            .update(categories)
            .set(updates)
            .where(eq(categories.id, existing.id));
        }

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "category.update",
          entity: "category",
          entityId: existing.id,
          details: { fields: changed },
        });

        const [result] = await tx
          .select()
          .from(categories)
          .where(eq(categories.id, existing.id))
          .limit(1);

        const [productCount] = await tx
          .select({ value: count() })
          .from(products)
          .where(eq(products.categoryId, existing.id));

        return { category: result, productCount: Number(productCount?.value ?? 0) };
      });

      res.json(
        serializeCategory(updated.category, updated.productCount),
      );
    } catch (error) {
      sendError(res, error, "Failed to update category");
    }
  },
);

adminCategoriesRouter.delete(
  "/categories/:id",
  async (req: Request, res: Response) => {
    if (req.admin?.role !== "owner") {
      res.status(403).json({ error: "Only the owner can delete categories." });
      return;
    }

    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ error: "A valid category id is required." });
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
          .from(categories)
          .where(eq(categories.id, id.data))
          .limit(1);

        if (!existing) {
          throw new HttpError(404, "Category not found.");
        }

        const [childCount] = await tx
          .select({ value: count() })
          .from(categories)
          .where(eq(categories.parentId, existing.id));

        const [productCount] = await tx
          .select({ value: count() })
          .from(products)
          .where(eq(products.categoryId, existing.id));

        const children = Number(childCount?.value ?? 0);
        const productTotal = Number(productCount?.value ?? 0);

        if (children > 0 || productTotal > 0) {
          const parts: string[] = [];
          if (children > 0) {
            parts.push(
              `${children} subcategor${children === 1 ? "y" : "ies"}`,
            );
          }
          if (productTotal > 0) {
            parts.push(
              `${productTotal} product${productTotal === 1 ? "" : "s"}`,
            );
          }

          throw new HttpError(
            409,
            `This category still has ${parts.join(" and ")}. Move or remove them before deleting it.`,
          );
        }

        await tx.delete(categories).where(eq(categories.id, existing.id));

        await writeAudit(tx, {
          adminUserId: req.admin!.id,
          action: "category.delete",
          entity: "category",
          entityId: existing.id,
          details: { fields: [] },
        });
      });

      res.json({ ok: true });
    } catch (error) {
      sendError(res, error, "Failed to delete category");
    }
  },
);
