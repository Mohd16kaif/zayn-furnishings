"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type AdminRole = "owner" | "staff";

type AdminMe = {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const navItems: Array<{ label: string; href: string }> = [
  { label: "Dashboard", href: "/admin" },
  { label: "Products", href: "/admin/products" },
  { label: "Categories", href: "/admin/categories" },
  { label: "Content", href: "/admin/content" },
  { label: "Delivery zones", href: "/admin/delivery" },
  { label: "Settings", href: "/admin/settings" },
];

const comingSoonItems = [
  "Orders",
  "Deliveries",
  "Customers",
];

export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [status, setStatus] = useState<"checking" | "ready" | "error">(
    "checking",
  );
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadAdmin() {
      setStatus("checking");
      setError("");

      try {
        const supabase = getSupabaseBrowserClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          router.replace("/admin/login");
          return;
        }

        const response = await fetch(`${apiUrl}/admin/me`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: "no-store",
        });

        if (response.status === 401 || response.status === 403) {
          await supabase.auth.signOut();
          router.replace("/admin/login?reason=unauthorized");
          return;
        }

        if (!response.ok) {
          throw new Error(`The API returned status ${response.status}.`);
        }

        const data = (await response.json()) as AdminMe;

        if (!cancelled) {
          setAdmin(data);
          setStatus("ready");
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load the admin session.",
          );
          setStatus("error");
        }
      }
    }

    loadAdmin();

    return () => {
      cancelled = true;
    };
  }, [attempt, router]);

  async function handleLogout() {
    try {
      await getSupabaseBrowserClient().auth.signOut();
    } finally {
      router.replace("/admin/login");
    }
  }

  if (status === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6">
        <div className="flex items-center gap-3 text-sm text-stone-600">
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-800"
            aria-hidden="true"
          />
          Checking admin access...
        </div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6">
        <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
          <h1 className="text-lg font-semibold text-stone-900">
            Could not load admin
          </h1>
          <p className="mt-2 text-sm text-stone-600" role="alert">
            {error}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
            >
              Back to login
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-stone-200 bg-white p-6 lg:flex lg:flex-col">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
              Zayn Furnishings
            </p>
            <h1 className="mt-1 text-xl font-semibold">Admin</h1>
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
                {admin?.name ?? admin?.email}
              </p>
              <p className="text-xs text-stone-500">
                {admin?.email} &middot; {admin?.role}
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
            >
              Logout
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
