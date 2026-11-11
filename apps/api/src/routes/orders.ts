import { and, eq, inArray } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import {
  calculateOrderTotals,
  calculateTaxCents,
  evaluateDiscountCode,
  type DiscountIneligibilityReason,
} from "@zayn/shared";
import { z } from "zod";
import { db } from "../db/client";
import {
  customers,
  deliveries,
  discountCodes,
  orderItems,
  orders,
  products,
  type Product,
} from "../db/schema";
import { sendValidationError } from "../lib/adminCatalog";
import { requireCustomer } from "../lib/customerAuth";
import { computeDeliveryQuote } from "../lib/deliveryPricing";
import { primaryImagesByProduct } from "../lib/productImages";
import { stripe } from "../lib/stripe";

const ORDER_RATE_LIMIT = 10;
const ORDER_RATE_LIMIT_WINDOW_MS = 60 * 1000;

const orderRateLimiter = rateLimit({
  windowMs: ORDER_RATE_LIMIT_WINDOW_MS,
  limit: ORDER_RATE_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
  message: {
    error: "Too many order attempts. Please try again in a minute.",
  },
});

const zipSchema = z
  .string()
  .trim()
  .regex(/^\d{5}$/, "Enter a 5-digit US ZIP code.");

const shippingAddressSchema = z.object({
  name: z.string().trim().min(1, "Enter the recipient's name.").max(200),
  line1: z.string().trim().min(1, "Enter the street address.").max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, "Enter the city.").max(120),
  state: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Use a 2-letter state code.")
    .transform((value) => value.toUpperCase()),
  zip: zipSchema,
});

const createOrderSchema = z
  .object({
    items: z
      .array(
        z.object({
          product_id: z.string().uuid("A valid product id is required."),
          quantity: z
            .number()
            .int("Quantity must be a whole number.")
            .min(1, "Quantity must be at least 1.")
            .max(10, "Quantity cannot exceed 10 per item."),
        }),
      )
      .min(1, "Your cart is empty.")
      .max(50, "Your cart has too many items."),
    zip: zipSchema,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .refine(
        (value) => z.string().email().safeParse(value).success,
        "Enter a valid email address.",
      ),
    shipping_address: shippingAddressSchema,
    discount_code: z.string().trim().min(1).max(64).optional(),
    sms_opt_in: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.shipping_address.zip !== value.zip) {
      ctx.addIssue({
        code: "custom",
        path: ["shipping_address", "zip"],
        message: "Shipping ZIP must match the delivery ZIP.",
      });
    }
  });

function normalizeOrderBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }

  const value = body as Record<string, unknown>;

  if (value.shipping_address !== undefined) {
    return value;
  }

  if (value.address !== undefined) {
    return { ...value, shipping_address: value.address };
  }

  if (
    typeof value.name === "string" &&
    typeof value.line1 === "string" &&
    typeof value.city === "string" &&
    typeof value.state === "string"
  ) {
    return {
      ...value,
      shipping_address: {
        name: value.name,
        line1: value.line1,
        line2: value.line2,
        city: value.city,
        state: value.state,
        zip: value.zip,
      },
    };
  }

  return value;
}

const DISCOUNT_ERRORS: Record<DiscountIneligibilityReason, string> = {
  inactive: "That discount code is not valid.",
  not_started: "That discount code is not active yet.",
  expired: "That discount code has expired.",
  min_order: "Your order does not meet the minimum for that discount code.",
  usage_limit: "That discount code has reached its usage limit.",
  invalid_value: "That discount code is not valid.",
};

type OrderLine = {
  product: Product;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export const ordersRouter = Router();

ordersRouter.post(
  "/orders",
  orderRateLimiter,
  requireCustomer,
  async (req: Request, res: Response) => {
    const parsed = createOrderSchema.safeParse(normalizeOrderBody(req.body));

    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    if (!stripe) {
      res.status(503).json({
        error: "Online payments are temporarily unavailable.",
      });
      return;
    }

    const input = parsed.data;

    try {
      const requested = new Map<string, number>();

      for (const item of input.items) {
        requested.set(
          item.product_id,
          (requested.get(item.product_id) ?? 0) + item.quantity,
        );
      }

      const productIds = Array.from(requested.keys());
      const rows = await db
        .select()
        .from(products)
        .where(inArray(products.id, productIds));
      const productsById = new Map(rows.map((row) => [row.id, row]));

      const unavailable: Array<{
        product_id: string;
        name: string | null;
        reason: "unavailable" | "insufficient_stock";
      }> = [];
      const lines: OrderLine[] = [];

      for (const [productId, quantity] of requested) {
        const product = productsById.get(productId);

        if (!product || product.status !== "active") {
          unavailable.push({
            product_id: productId,
            name: product?.name ?? null,
            reason: "unavailable",
          });
          continue;
        }

        if (product.stockQty < quantity) {
          unavailable.push({
            product_id: productId,
            name: product.name,
            reason: "insufficient_stock",
          });
          continue;
        }

        const unitPriceCents =
          product.salePriceCents ?? product.priceCents;

        lines.push({
          product,
          quantity,
          unitPriceCents,
          lineTotalCents: unitPriceCents * quantity,
        });
      }

      if (unavailable.length > 0) {
        res.status(409).json({
          error:
            "Some items are no longer available. Please update your cart and try again.",
          unavailable,
        });
        return;
      }

      const subtotalCents = lines.reduce(
        (total, line) => total + line.lineTotalCents,
        0,
      );
      const { zone, computation } = await computeDeliveryQuote(
        db,
        input.zip,
        subtotalCents,
      );

      if (!zone) {
        res.status(422).json({
          error: `We do not currently deliver to ZIP ${input.zip}.`,
        });
        return;
      }

      let discountCents = 0;
      let appliedDiscountCode: string | null = null;

      if (input.discount_code) {
        const normalizedCode = input.discount_code.trim().toUpperCase();
        const [code] = await db
          .select()
          .from(discountCodes)
          .where(eq(discountCodes.code, normalizedCode))
          .limit(1);

        if (!code) {
          res.status(422).json({ error: DISCOUNT_ERRORS.inactive });
          return;
        }

        const evaluation = evaluateDiscountCode(
          {
            type: code.type,
            value: code.value,
            minOrderCents: code.minOrderCents,
            startsAt: code.startsAt,
            endsAt: code.endsAt,
            usageLimit: code.usageLimit,
            usedCount: code.usedCount,
            isActive: code.isActive,
          },
          subtotalCents,
        );

        if (!evaluation.eligible) {
          res.status(422).json({
            error: DISCOUNT_ERRORS[evaluation.reason],
          });
          return;
        }

        discountCents = evaluation.discountCents;
        appliedDiscountCode = code.code;
      }

      const taxCents = calculateTaxCents(subtotalCents, {
        state: input.shipping_address.state,
        zip: input.shipping_address.zip,
      });
      const totals = calculateOrderTotals({
        subtotalCents,
        discountCents,
        deliveryFeeCents: computation.feeCents,
        taxCents,
      });

      const address = input.shipping_address;
      const customerId = req.customer!.id;
      const created = await db.transaction(async (tx) => {
        const images = await primaryImagesByProduct(tx, productIds);
        const [existingCustomer] = await tx
          .select()
          .from(customers)
          .where(eq(customers.id, customerId))
          .for("update");

        if (!existingCustomer) {
          throw new Error("Customer account no longer exists.");
        }

        const [customer] = await tx
          .update(customers)
          .set({
            email: input.email,
            name: existingCustomer.name || address.name,
            ...(input.sms_opt_in
              ? {
                  smsOptIn: true,
                  smsOptInAt: new Date(),
                }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(customers.id, existingCustomer.id))
          .returning({
            id: customers.id,
            phone: customers.phone,
          });

        const [order] = await tx
          .insert(orders)
          .values({
            customerId: customer.id,
            email: input.email,
            status: "pending",
            subtotalCents: totals.subtotalCents,
            discountCents: totals.discountCents,
            deliveryFeeCents: totals.deliveryFeeCents,
            taxCents: totals.taxCents,
            totalCents: totals.totalCents,
            discountCode: appliedDiscountCode,
            shippingName: address.name,
            shippingLine1: address.line1,
            shippingLine2: address.line2 ?? null,
            shippingCity: address.city,
            shippingState: address.state,
            shippingZip: address.zip,
            shippingPhone: customer.phone,
          })
          .returning({
            id: orders.id,
            orderNumber: orders.orderNumber,
          });

        await tx.insert(orderItems).values(
          lines.map((line) => ({
            orderId: order.id,
            productId: line.product.id,
            nameSnapshot: line.product.name,
            skuSnapshot: line.product.sku,
            imageUrlSnapshot: images.get(line.product.id) ?? null,
            unitPriceCents: line.unitPriceCents,
            quantity: line.quantity,
            lineTotalCents: line.lineTotalCents,
          })),
        );

        await tx.insert(deliveries).values({
          orderId: order.id,
          method: null,
          status: "pending",
        });

        return order;
      });

      let paymentIntent;

      try {
        paymentIntent = await stripe.paymentIntents.create(
          {
            amount: totals.totalCents,
            currency: "usd",
            automatic_payment_methods: { enabled: true },
            metadata: {
              order_id: created.id,
              order_number: created.orderNumber,
            },
            receipt_email: input.email,
            description: `Order ${created.orderNumber}`,
          },
          { idempotencyKey: `order-intent-${created.id}` },
        );

        await db
          .update(orders)
          .set({
            stripePaymentIntentId: paymentIntent.id,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, created.id));
      } catch (error) {
        console.error(
          "Stripe PaymentIntent creation failed:",
          error instanceof Error ? error.message : error,
        );

        await db
          .update(orders)
          .set({
            status: "cancelled",
            cancelledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(orders.id, created.id));

        res.status(502).json({
          error:
            "We could not start the payment. Please try again or contact us.",
        });
        return;
      }

      res.status(201).json({
        order_number: created.orderNumber,
        client_secret: paymentIntent.client_secret,
        total_cents: totals.totalCents,
        breakdown: {
          subtotal_cents: totals.subtotalCents,
          discount_cents: totals.discountCents,
          delivery_fee_cents: totals.deliveryFeeCents,
          tax_cents: totals.taxCents,
          total_cents: totals.totalCents,
          discount_code: appliedDiscountCode,
        },
      });
    } catch (error) {
      console.error(
        "Failed to create order:",
        error instanceof Error ? error.message : error,
      );
      res.status(500).json({
        error: "We could not create your order. Please try again.",
      });
    }
  },
);

ordersRouter.get(
  "/orders/:orderNumber",
  requireCustomer,
  async (req: Request, res: Response) => {
    const parsed = z
      .string()
      .trim()
      .min(1)
      .max(40)
      .safeParse(req.params.orderNumber);

    if (!parsed.success) {
      res.status(400).json({ error: "A valid order number is required." });
      return;
    }

    if (!db) {
      res.status(500).json({ error: "Database is not configured" });
      return;
    }

    try {
      const [order] = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.orderNumber, parsed.data),
            eq(orders.customerId, req.customer!.id),
          ),
        )
        .limit(1);

      if (!order) {
        res.status(404).json({ error: "Order not found." });
        return;
      }

      const [items, deliveryRows] = await Promise.all([
        db
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id)),
        db
          .select()
          .from(deliveries)
          .where(eq(deliveries.orderId, order.id))
          .limit(1),
      ]);
      const delivery = deliveryRows[0] ?? null;

      res.set("Cache-Control", "no-store");
      res.json({
        order_number: order.orderNumber,
        status: order.status,
        created_at: order.createdAt,
        subtotal_cents: order.subtotalCents,
        discount_cents: order.discountCents,
        delivery_fee_cents: order.deliveryFeeCents,
        tax_cents: order.taxCents,
        total_cents: order.totalCents,
        discount_code: order.discountCode,
        address: {
          name: order.shippingName,
          line1: order.shippingLine1,
          line2: order.shippingLine2,
          city: order.shippingCity,
          state: order.shippingState,
          zip: order.shippingZip,
        },
        delivery_status: delivery?.status ?? null,
        delivery: delivery
          ? {
              status: delivery.status,
              method: delivery.method,
              scheduled_date: delivery.scheduledDate,
              time_window: delivery.timeWindow,
              tracking_number: delivery.trackingNumber,
              carrier: delivery.carrier,
            }
          : null,
        items: items.map((item) => ({
          product_id: item.productId,
          name: item.nameSnapshot,
          sku: item.skuSnapshot,
          image_url: item.imageUrlSnapshot,
          unit_price_cents: item.unitPriceCents,
          quantity: item.quantity,
          line_total_cents: item.lineTotalCents,
        })),
      });
    } catch (error) {
      console.error(
        "Failed to load customer order:",
        error instanceof Error ? error.message : error,
      );
      res.status(500).json({ error: "We could not load that order." });
    }
  },
);
