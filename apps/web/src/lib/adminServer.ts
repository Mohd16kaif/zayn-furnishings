import type { AdminMe } from "./adminApi";
import { callAdminAuthApi } from "./adminAuthApi";
import { getAdminSessionToken } from "./adminSession";
import { readApiJson } from "./authApi";

function isAdminMe(value: unknown): value is AdminMe {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.email === "string" &&
    (candidate.name === null || typeof candidate.name === "string") &&
    (candidate.role === "owner" || candidate.role === "staff")
  );
}

export async function getCurrentAdmin(options: {
  timeoutMs?: number;
} = {}): Promise<AdminMe | null> {
  const token = await getAdminSessionToken();

  if (!token) {
    return null;
  }

  try {
    const response = await callAdminAuthApi("/admin/me", {
      sessionToken: token,
      timeoutMs: options.timeoutMs,
    });

    if (!response.ok) {
      return null;
    }

    const data = await readApiJson(response);

    return isAdminMe(data) ? data : null;
  } catch {
    return null;
  }
}
