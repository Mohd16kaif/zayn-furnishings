export const instant = false;

const cards = [
  {
    title: "Products",
    description: "Catalog, inventory, and pricing will live here.",
  },
  {
    title: "Orders",
    description: "Paid orders, fulfillment, and refunds will live here.",
  },
  {
    title: "Deliveries",
    description: "Scheduling and delivery zones will live here.",
  },
];

export default function AdminDashboardPage() {
  return (
    <div>
      <div className="max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-stone-400">
          Dashboard
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Welcome back
        </h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          You are signed in to the Zayn Furnishings admin. The rest of the
          admin areas will come online as the store is built.
        </p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <section
            key={card.title}
            className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-base font-semibold text-stone-900">
              {card.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              {card.description}
            </p>
            <span className="mt-4 inline-flex rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-500">
              Coming soon
            </span>
          </section>
        ))}
      </div>
    </div>
  );
}
