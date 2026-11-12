export type SessionCustomer = {
  id: string;
  phone_masked: string;
  email: string | null;
  name: string | null;
};

export function isSessionCustomer(value: unknown): value is SessionCustomer {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.phone_masked === "string" &&
    (candidate.email === null || typeof candidate.email === "string") &&
    (candidate.name === null || typeof candidate.name === "string")
  );
}
