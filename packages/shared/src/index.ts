export * from "./public";
export * from "./delivery";
export * from "./tokens";

export const API_NAME = "zayn-furnishings-api";

export interface HealthResponse {
  status: "ok";
  db: boolean;
  time: string;
}

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
  currency: "USD";
}
