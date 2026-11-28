"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { AdminMe } from "@/lib/adminApi";
import { useInFlightGuard } from "@/lib/useInFlightGuard";

const navItems: Array<{ label: string; href: string }> = [
  { label: "Dashboard", href: "/admin" },
  { label: "Orders", href: "/admin/orders" },
  { label: "Products", href: "/admin/products" },
  { label: "Categories", href: "/admin/categories" },
  { label: "Content", href: "/admin/content" },
  { label: "Delivery zones", href: "/admin/delivery" },
  { label: "Settings", href: "/admin/settings" },
];

const comingSoonItems = [
  "Deliveries",
  "Customers",
];

export function AdminShell({
  admin,
  children,
}: {
  admin: AdminMe;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const inFlight = useInFlightGuard();

  async function handleLogout() {
    if (loggingOut || !inFlight.begin()) {
      return;
    }

    setLoggingOut(true);

    try {
      await fetch("/api/admin-auth/logout", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch {
      // The redirect still needs to happen if the request fails.
    } finally {
      inFlight.end();
      router.replace("/admin/login");
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-stone-200 bg-white p-6 lg:flex lg:flex-col">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
              Zayn Furnishings
            </p>
            <p className="mt-1 text-xl font-semibold">Admin</p>
          </div>

          <nav className="mt-8 space-y-1" aria-label="Admin navigation">
            {navItems.map((item) => {
              const isActive =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${
                    isActive
                      ? "bg-stone-900 text-white"
                      : "text-stone-700 hover:bg-stone-100"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}

            <div
              className="pt-4"
              aria-label="Coming soon"
            >
              <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
                Coming soon
              </p>
              <div className="mt-2 space-y-1 border-t border-stone-200 pt-3">
                {comingSoonItems.map((label) => (
                  <span
                    key={label}
                    aria-disabled="true"
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-stone-400"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 bg-white px-6 py-4">
            <div>
              <p className="text-sm font-medium text-stone-900">
                {admin.name ?? admin.email}
              </p>
              <p className="text-xs text-stone-500">
                {admin.email} &middot; {admin.role}
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loggingOut ? "Logging out..." : "Logout"}
            </button>
          </header>

          <div className="flex-1 p-6 lg:p-10">
            <nav
              className="mb-3 flex flex-wrap gap-2 lg:hidden"
              aria-label="Admin navigation"
            >
              {navItems.map((item) => {
                const isActive =
                  item.href === "/admin"
                    ? pathname === "/admin"
                    : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      isActive
                        ? "bg-stone-900 text-white"
                        : "border border-stone-200 text-stone-700"
                    }`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <nav
              className="mb-6 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3 lg:hidden"
              aria-label="Coming soon"
            >
              <span className="w-full text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
                Coming soon
              </span>
              {comingSoonItems.map((label) => (
                <span
                  key={label}
                  aria-disabled="true"
                  className="rounded-full border border-stone-200 px-3 py-1 text-xs text-stone-400"
                >
                  {label}
                </span>
              ))}
            </nav>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
