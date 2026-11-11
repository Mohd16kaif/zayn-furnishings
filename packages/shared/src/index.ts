export * from "./public";
export * from "./delivery";
export * from "./pricing";
export * from "./phone";
export * from "./tokens";
export * from "./zipCoverage";
export * from "./content";

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
