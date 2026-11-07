import { LoginForm } from "./login-form";

export const instant = false;

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-400">
            Zayn Furnishings
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-900">
            Admin sign in
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            We will email you a six-digit code.
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
          <LoginForm unauthorized={params.reason === "unauthorized"} />
        </div>
      </div>
    </main>
  );
}
