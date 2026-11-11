import { relations } from "drizzle-orm";
import { adminUsers } from "./admin";
import { auditLog } from "./audit";
import { customerSessions } from "./auth";
import { cartItems, carts } from "./carts";
import { categories } from "./categories";
import { addresses, customers } from "./customers";
import { deliveries } from "./deliveries";
import { stockMovements } from "./inventory";
import { contentBlocks, discountCodes } from "./marketing";
import { notificationsLog } from "./notifications";
import { orderItems, orders } from "./orders";
import { payments } from "./payments";
import { productImages, products } from "./products";

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "categoryTree",
  }),
  children: many(categories, { relationName: "categoryTree" }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  images: many(productImages),
  cartItems: many(cartItems),
  orderItems: many(orderItems),
  stockMovements: many(stockMovements),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  addresses: many(addresses),
  carts: many(carts),
  orders: many(orders),
  notifications: many(notificationsLog),
  sessions: many(customerSessions),
}));

export const customerSessionsRelations = relations(
  customerSessions,
  ({ one }) => ({
    customer: one(customers, {
      fields: [customerSessions.customerId],
      references: [customers.id],
    }),
  }),
);

export const addressesRelations = relations(addresses, ({ one }) => ({
  customer: one(customers, {
    fields: [addresses.customerId],
    references: [customers.id],
  }),
}));

export const cartsRelations = relations(carts, ({ one, many }) => ({
  customer: one(customers, {
    fields: [carts.customerId],
    references: [customers.id],
  }),
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, {
    fields: [cartItems.cartId],
    references: [carts.id],
  }),
  product: one(products, {
    fields: [cartItems.productId],
    references: [products.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  items: many(orderItems),
  payments: many(payments),
  delivery: one(deliveries, {
    fields: [orders.id],
    references: [deliveries.orderId],
  }),
  stockMovements: many(stockMovements),
  notifications: many(notificationsLog),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, {
    fields: [payments.orderId],
    references: [orders.id],
  }),
}));

export const deliveriesRelations = relations(deliveries, ({ one }) => ({
  order: one(orders, {
    fields: [deliveries.orderId],
    references: [orders.id],
  }),
}));

export const adminUsersRelations = relations(adminUsers, ({ many }) => ({
  stockMovements: many(stockMovements),
  auditLogs: many(auditLog),
}));

export const stockMovementsRelations = relations(
  stockMovements,
  ({ one }) => ({
    product: one(products, {
      fields: [stockMovements.productId],
      references: [products.id],
    }),
    order: one(orders, {
      fields: [stockMovements.orderId],
      references: [orders.id],
    }),
    adminUser: one(adminUsers, {
      fields: [stockMovements.adminUserId],
      references: [adminUsers.id],
    }),
  }),
);

export const notificationsLogRelations = relations(
  notificationsLog,
  ({ one }) => ({
    customer: one(customers, {
      fields: [notificationsLog.customerId],
      references: [customers.id],
    }),
    order: one(orders, {
      fields: [notificationsLog.orderId],
      references: [orders.id],
    }),
  }),
);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  adminUser: one(adminUsers, {
    fields: [auditLog.adminUserId],
    references: [adminUsers.id],
  }),
}));

export const discountCodesRelations = relations(discountCodes, () => ({}));

export const contentBlocksRelations = relations(contentBlocks, () => ({}));
