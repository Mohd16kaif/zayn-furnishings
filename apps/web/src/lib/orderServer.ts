import { callApiWithSession, readApiJson } from "./authApi";
import {
  isCustomerOrderDetail,
  isCustomerOrderList,
  type CustomerOrderDetail,
  type CustomerOrderList,
} from "./orderTypes";

export type CustomerOrderResult =
  | { status: "ok"; order: CustomerOrderDetail }
  | { status: "not_found" }
  | { status: "unauthorized" }
  | { status: "error" };

export async function fetchCustomerOrders(
  page = 1,
): Promise<CustomerOrderList | null> {
  try {
    const { response, authenticated } = await callApiWithSession(
      `/api/orders?page=${page}&page_size=10`,
    );

    if (!authenticated || !response || !response.ok) {
      return null;
    }

    const data = await readApiJson(response);

    return isCustomerOrderList(data) ? data : null;
  } catch {
    return null;
  }
}

export async function fetchCustomerOrder(
  orderNumber: string,
): Promise<CustomerOrderResult> {
  try {
    const { response, authenticated } = await callApiWithSession(
      `/api/orders/${encodeURIComponent(orderNumber)}`,
    );

    if (!authenticated) {
      return { status: "unauthorized" };
    }

    if (!response) {
      return { status: "error" };
    }

    if (response.status === 401) {
      return { status: "unauthorized" };
    }

    if (response.status === 404) {
      return { status: "not_found" };
    }

    if (!response.ok) {
      return { status: "error" };
    }

    const data = await readApiJson(response);

    return isCustomerOrderDetail(data)
      ? { status: "ok", order: data }
      : { status: "error" };
  } catch {
    return { status: "error" };
  }
}
