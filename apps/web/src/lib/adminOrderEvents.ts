type OrdersChangedListener = () => void;

const listeners = new Set<OrdersChangedListener>();

export function notifyOrdersChanged(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeToOrdersChanged(
  listener: OrdersChangedListener,
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
