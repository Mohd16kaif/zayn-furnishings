import {
  callApiWithSession,
  getSessionToken,
  readApiJson,
} from "./authApi";
import { isSessionCustomer, type SessionCustomer } from "./customer";

/**
 * Reads the zf_session HttpOnly cookie server-side and asks the API who the
 * signed-in customer is. The session token never leaves the server.
 */
export async function getCurrentCustomer(): Promise<SessionCustomer | null> {
  const token = await getSessionToken();

  if (!token) {
    return null;
  }

  try {
    const { response, authenticated } = await callApiWithSession(
      "/api/auth/me",
    );

    if (!authenticated || !response || !response.ok) {
      return null;
    }

    const data = await readApiJson(response);

    if (typeof data !== "object" || data === null) {
      return null;
    }

    const customer = (data as { customer?: unknown }).customer;

    return isSessionCustomer(customer) ? customer : null;
  } catch {
    return null;
  }
}
