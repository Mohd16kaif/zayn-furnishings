import { OrderDetailClient } from "./order-detail-client";

export const instant = false;

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;

  return <OrderDetailClient orderNumber={orderNumber} />;
}
