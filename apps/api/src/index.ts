import cors from "cors";
import express from "express";
import helmet from "helmet";
import { API_NAME } from "@zayn/shared";
import { env } from "./config/env";
import { adminAuthRouter } from "./routes/adminAuth";
import { adminCategoriesRouter } from "./routes/adminCategories";
import { adminContentRouter } from "./routes/adminContent";
import { adminDeliveryZonesRouter } from "./routes/adminDeliveryZones";
import { adminProductsRouter } from "./routes/adminProducts";
import { adminSettingsRouter } from "./routes/adminSettings";
import { activePhoneVerifierName } from "./lib/phoneVerifier";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { ordersRouter } from "./routes/orders";
import { publicRouter } from "./routes/public";
import { stripeWebhookRouter } from "./routes/webhooks";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
// Stripe signs the exact request bytes, so this must stay ahead of
// express.json() or the signature check will always fail.
app.use("/webhooks", stripeWebhookRouter);
app.use(express.json({ limit: "1mb" }));

// Required behind Render's proxy so rate limiting sees the real client IP.
app.set("trust proxy", 1);

app.get("/", (_req, res) => {
  res.json({ name: API_NAME, status: "ok" });
});

app.use(healthRouter);
app.use("/api/auth", authRouter);
app.use("/api", ordersRouter);
app.use("/api/public", publicRouter);
app.use("/admin", adminAuthRouter);
app.use("/admin", adminCategoriesRouter);
app.use("/admin", adminContentRouter);
app.use("/admin", adminSettingsRouter);
app.use("/admin", adminDeliveryZonesRouter);
app.use("/admin", adminProductsRouter);

console.log(`Phone verifier: ${activePhoneVerifierName}`);

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
