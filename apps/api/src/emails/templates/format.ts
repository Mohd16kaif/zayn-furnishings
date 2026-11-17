export function formatEmailMoney(cents: number): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const dollars = Math.floor(absolute / 100).toLocaleString("en-US");
  const remainder = (absolute % 100).toString().padStart(2, "0");

  return `${sign}$${dollars}.${remainder}`;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatEmailDate(dateOnly: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly.trim());

  if (!match) {
    return dateOnly;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return dateOnly;
  }

  return `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}
