import cors from "cors";
import express from "express";
import helmet from "helmet";
import { API_NAME } from "@zayn/shared";
import { env } from "./config/env";
import { adminAuthRouter } from "./routes/adminAuth";
import { healthRouter } from "./routes/health";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json());

// Required behind Render's proxy so rate limiting sees the real client IP.
app.set("trust proxy", 1);

app.get("/", (_req, res) => {
  res.json({ name: API_NAME, status: "ok" });
});

app.use(healthRouter);
app.use("/admin", adminAuthRouter);

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
