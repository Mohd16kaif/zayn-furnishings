export function formatEmailMoney(cents: number): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const dollars = Math.floor(absolute / 100).toLocaleString("en-US");
  const remainder = (absolute % 100).toString().padStart(2, "0");

  return `${sign}$${dollars}.${remainder}`;
}
