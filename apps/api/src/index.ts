import cors from "cors";
import express from "express";
import helmet from "helmet";
import { API_NAME } from "@zayn/shared";
import { env } from "./config/env";
import { healthRouter } from "./routes/health";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ name: API_NAME, status: "ok" });
});

app.use(healthRouter);

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
