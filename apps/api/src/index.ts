import cors from "cors";
import express from "express";
import helmet from "helmet";
import { API_NAME } from "@zayn/shared";
import {
  adminAuthSecretIsDevFallback,
  env,
} from "./config/env";
import { initializeEmailSender } from "./emails/sender";
import { adminCodeAuthRouter } from "./routes/adminCodeAuth";
import { adminCategoriesRouter } from "./routes/adminCategories";
import { adminContentRouter } from "./routes/adminContent";
import { adminDashboardRouter } from "./routes/adminDashboard";
import { adminDeliveryZonesRouter } from "./routes/adminDeliveryZones";
import { adminOrdersRouter } from "./routes/adminOrders";
import { adminPriceChangesRouter } from "./routes/adminPriceChanges";
import { adminProductsRouter } from "./routes/adminProducts";
import { adminSettingsRouter } from "./routes/adminSettings";
import { activePhoneVerifierName } from "./lib/phoneVerifier";
import { testStripeKeyInProductionWarning } from "./lib/stripeKeyGuard";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { registerMediaRoute } from "./routes/media";
import { ordersRouter } from "./routes/orders";
import { publicRouter } from "./routes/public";
import { stripeWebhookRouter } from "./routes/webhooks";

initializeEmailSender();

const app = express();

// Required behind Render's proxy so rate limiting sees the real client IP.
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-admin-session",
    ],
  }),
);
registerMediaRoute(app, {
  mediaDir: env.MEDIA_DIR,
});

// Stripe signs the exact request bytes, so this must stay ahead of
// express.json() or the signature check will always fail.
app.use("/webhooks", stripeWebhookRouter);
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({ name: API_NAME, status: "ok" });
});

app.use(healthRouter);
app.use("/api/auth", authRouter);
app.use("/api", ordersRouter);
app.use("/api/public", publicRouter);
app.use("/admin", adminCodeAuthRouter);
app.use("/admin", adminCategoriesRouter);
app.use("/admin", adminContentRouter);
app.use("/admin", adminSettingsRouter);
app.use("/admin", adminDeliveryZonesRouter);
app.use("/admin", adminOrdersRouter);
app.use("/admin", adminDashboardRouter);
app.use("/admin", adminProductsRouter);
app.use("/admin", adminPriceChangesRouter);

if (adminAuthSecretIsDevFallback) {
  console.warn(
    "WARNING: ADMIN_AUTH_SECRET is not set. Using the built-in development-only fallback. Set ADMIN_AUTH_SECRET before staging or production.",
  );
}

console.log(`App environment: ${env.APP_ENV}`);
console.log(`Media directory: ${env.MEDIA_DIR}`);
console.log(`Phone verifier: ${activePhoneVerifierName}`);

const stripeKeyWarning = testStripeKeyInProductionWarning(
  env.APP_ENV,
  env.STRIPE_SECRET_KEY,
);

if (stripeKeyWarning) {
  console.warn(stripeKeyWarning);
}

console.log(
  env.STRIPE_WEBHOOK_SECRET
    ? `Stripe webhook secret configured, ends ...${env.STRIPE_WEBHOOK_SECRET.slice(-4)}`
    : "Stripe webhook secret not configured",
);

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
