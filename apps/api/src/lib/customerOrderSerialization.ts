export type CustomerDeliverySource = {
  status: string;
  method: string | null;
  partnerName: string | null;
  scheduledDate: string | null;
  timeWindow: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  driverNotes?: string | null;
};

export type CustomerDelivery = {
  status: string;
  method: string | null;
  partner_name: string | null;
  scheduled_date: string | null;
  time_window: string | null;
  tracking_number: string | null;
  carrier: string | null;
};

/**
 * The only delivery fields a customer is allowed to see. Driver notes and any
 * other internal delivery data must never pass through this function.
 */
export function serializeCustomerDelivery(
  delivery: CustomerDeliverySource,
): CustomerDelivery {
  return {
    status: delivery.status,
    method: delivery.method,
    partner_name: delivery.partnerName,
    scheduled_date: delivery.scheduledDate,
    time_window: delivery.timeWindow,
    tracking_number: delivery.trackingNumber,
    carrier: delivery.carrier,
  };
}
