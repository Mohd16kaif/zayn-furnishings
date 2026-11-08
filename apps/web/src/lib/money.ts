export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) {
    return "";
  }

  const rounded = Math.round(cents);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const dollars = Math.floor(absolute / 100);
  const remainder = (absolute % 100).toString().padStart(2, "0");

  return `${sign}$${dollars.toLocaleString("en-US")}.${remainder}`;
}

export function centsToDollarInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) {
    return "";
  }

  const rounded = Math.round(cents);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const dollars = Math.floor(absolute / 100);
  const remainder = (absolute % 100).toString().padStart(2, "0");

  return `${sign}${dollars}.${remainder}`;
}

export function dollarsToCents(value: string): number | null {
  const trimmed = value.trim().replace(/[$,]/g, "");

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100);
}
