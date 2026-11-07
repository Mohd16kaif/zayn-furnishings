import { Router } from "express";
import type { HealthResponse } from "@zayn/shared";
import { isDatabaseHealthy } from "../db/client";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  let db = false;

  try {
    db = await isDatabaseHealthy();
  } catch (error) {
    console.error("Database health check failed:", error);
  }

  const body: HealthResponse = {
    status: "ok",
    db,
    time: new Date().toISOString(),
  };

  res.json(body);
});
