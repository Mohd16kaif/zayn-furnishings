export interface RenderTokensSettings {
  free_delivery_threshold_cents: number | null;
}

const TOKEN_PATTERN = /\{\{free_delivery_threshold\}\}/g;

function formatDollars(cents: number): string {
  const normalized = Math.max(0, Math.round(cents));
  const whole = Math.floor(normalized / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const remainder = normalized % 100;

  return remainder === 0
    ? `$${whole}`
    : `$${whole}.${remainder.toString().padStart(2, "0")}`;
}

function removeTokenLines(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];

  for (const line of lines) {
    if (!line.includes("{{free_delivery_threshold}}")) {
      kept.push(line);
      continue;
    }

    const sentences = line.split(/(?<=[.!?])\s+/);
    const remaining = sentences
      .filter(
        (sentence) =>
          !sentence.includes("{{free_delivery_threshold}}"),
      )
      .join(" ")
      .trim();

    if (remaining) {
      kept.push(remaining);
    }
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Replaces {{free_delivery_threshold}} with a formatted amount.
 * When the threshold is null, the containing sentence/line is removed
 * instead of showing a raw token or "$null".
 */
export function renderTokens(
  text: string | null | undefined,
  settings: RenderTokensSettings,
): string {
  if (!text) {
    return "";
  }

  const threshold = settings.free_delivery_threshold_cents;

  if (!text.includes("{{free_delivery_threshold}}")) {
    return text;
  }

  if (threshold === null) {
    return removeTokenLines(text);
  }

  return text.replace(TOKEN_PATTERN, formatDollars(threshold));
}
