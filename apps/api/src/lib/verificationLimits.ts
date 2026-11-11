const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const START_PHONE_LIMIT = 3;
export const START_PHONE_WINDOW_MS = 10 * MINUTE_MS;
export const START_IP_HOURLY_LIMIT = 10;
export const START_IP_HOURLY_WINDOW_MS = HOUR_MS;
export const START_IP_DAILY_LIMIT = 30;
export const START_IP_DAILY_WINDOW_MS = DAY_MS;
export const CHECK_FAILURE_LIMIT = 5;
export const CHECK_FAILURE_WINDOW_MS = 10 * MINUTE_MS;
export const CHECK_LOCK_MS = 15 * MINUTE_MS;

export type VerificationAttemptKind = "start" | "check";

export interface VerificationAttempt {
  phone: string;
  ip: string | null;
  kind: VerificationAttemptKind;
  success: boolean;
  createdAt: Date;
}

export type VerificationLimitDecision =
  | { allowed: true; retryAfterSeconds: 0 }
  | { allowed: false; retryAfterSeconds: number };

function secondsUntil(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 1000));
}

function windowRetryAfter(
  attempts: VerificationAttempt[],
  limit: number,
  windowMs: number,
  now: number,
): number {
  if (attempts.length < limit) {
    return 0;
  }

  const sorted = [...attempts].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const index = sorted.length - limit;
  const expiresAt = sorted[index].createdAt.getTime() + windowMs;

  return expiresAt > now ? secondsUntil(expiresAt, now) : 0;
}

export function decideStartLimit(
  attempts: VerificationAttempt[],
  phone: string,
  ip: string | null,
  now: Date = new Date(),
): VerificationLimitDecision {
  const nowMs = now.getTime();
  const starts = attempts.filter((attempt) => attempt.kind === "start");

  const phoneStarts = starts.filter(
    (attempt) =>
      attempt.phone === phone &&
      nowMs - attempt.createdAt.getTime() < START_PHONE_WINDOW_MS,
  );
  const ipStarts = ip
    ? starts.filter(
        (attempt) =>
          attempt.ip === ip &&
          nowMs - attempt.createdAt.getTime() < START_IP_DAILY_WINDOW_MS,
      )
    : [];

  const retryAfterSeconds = Math.max(
    windowRetryAfter(
      phoneStarts,
      START_PHONE_LIMIT,
      START_PHONE_WINDOW_MS,
      nowMs,
    ),
    windowRetryAfter(
      ipStarts.filter(
        (attempt) =>
          nowMs - attempt.createdAt.getTime() < START_IP_HOURLY_WINDOW_MS,
      ),
      START_IP_HOURLY_LIMIT,
      START_IP_HOURLY_WINDOW_MS,
      nowMs,
    ),
    windowRetryAfter(
      ipStarts,
      START_IP_DAILY_LIMIT,
      START_IP_DAILY_WINDOW_MS,
      nowMs,
    ),
  );

  if (retryAfterSeconds > 0) {
    return { allowed: false, retryAfterSeconds };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function decideVerifyLock(
  attempts: VerificationAttempt[],
  phone: string,
  now: Date = new Date(),
): VerificationLimitDecision {
  const nowMs = now.getTime();
  const failures = attempts
    .filter(
      (attempt) =>
        attempt.kind === "check" &&
        !attempt.success &&
        attempt.phone === phone,
    )
    .map((attempt) => attempt.createdAt.getTime())
    .sort((a, b) => a - b);

  let lockUntil = 0;

  for (let index = 0; index + CHECK_FAILURE_LIMIT - 1 < failures.length; index += 1) {
    const first = failures[index];
    const fifth = failures[index + CHECK_FAILURE_LIMIT - 1];

    if (fifth - first <= CHECK_FAILURE_WINDOW_MS) {
      lockUntil = Math.max(lockUntil, fifth + CHECK_LOCK_MS);
    }
  }

  if (lockUntil > nowMs) {
    return {
      allowed: false,
      retryAfterSeconds: secondsUntil(lockUntil, nowMs),
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}
