export function StagingBanner() {
  return (
    <div
      role="status"
      className="w-full bg-amber-400 px-3 py-1.5 text-center text-xs font-semibold uppercase tracking-[0.14em] text-stone-950"
    >
      STAGING: test site, no real orders
    </div>
  );
}

export function StorePreviewBanner() {
  return (
    <div
      role="status"
      className="w-full bg-stone-900 px-3 py-1.5 text-center text-xs font-medium tracking-[0.02em] text-white"
    >
      Preview: the store is closed to customers
    </div>
  );
}
