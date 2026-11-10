import { formatCents } from "@/lib/money";

export function formatAdminDollars(cents: number | null): string {
  if (cents === null) {
    return "—";
  }

  return formatCents(cents).replace(/\.00$/, "");
}

export function centsToDollarsInput(cents: number | null): string {
  if (cents === null) {
    return "";
  }

  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

export function dollarsToCents(value: string): number | null {
  const normalized = value.replace(/[$,\s]/g, "").trim();

  if (!normalized) {
    return null;
  }

  const dollars = Number(normalized);

  if (!Number.isFinite(dollars) || dollars < 0) {
    return null;
  }

  return Math.round(dollars * 100);
}
