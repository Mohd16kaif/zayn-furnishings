"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const RESEND_SECONDS = 30;

export function LoginForm({ unauthorized }: { unauthorized: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setResendIn((value) => Math.max(0, value - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [resendIn]);

  async function requestCode(address: string, isResend = false) {
    setLoading(true);
    setError("");
    setStatus("");

    try {
      const response = await fetch(`${apiUrl}/admin/auth/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address }),
      });

      if (response.status === 429) {
        throw new Error(
          "Too many attempts. Please wait a few minutes and try again.",
        );
      }

      if (!response.ok) {
        throw new Error("We could not send a code. Please try again.");
      }

      setStep("code");
      setCode("");
      setResendIn(RESEND_SECONDS);
      setStatus(
        isResend
          ? "A new code has been sent."
          : "If this email is registered, a code has been sent.",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We could not send a code. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim().toLowerCase();

    if (!address) {
      setError("Enter your email address.");
      return;
    }

    await requestCode(address);
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");

    if (!/^\d{6}$/.test(code)) {
      setError("Enter the six-digit code from your email.");
      return;
    }

    setLoading(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });

      if (verifyError) {
        throw new Error(
          "That code is invalid or expired. Check the code and try again.",
        );
      }

      router.replace("/admin");
    } catch (verifyFailure) {
      setError(
        verifyFailure instanceof Error
          ? verifyFailure.message
          : "That code is invalid or expired. Please try again.",
      );
      setLoading(false);
    }
  }

  return (
    <div>
      {unauthorized ? (
        <p
          role="alert"
          className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          This email is not authorized.
        </p>
      ) : null}

      {step === "email" ? (
        <form onSubmit={handleRequest} className="space-y-5" noValidate>
          <div>
            <label
              htmlFor="admin-email"
              className="block text-sm font-medium text-stone-800"
            >
              Email address
            </label>
            <input
              id="admin-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10"
              placeholder="owner@example.com"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Sending code..." : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="space-y-5" noValidate>
          <div>
            <p className="text-sm text-stone-600">
              Code sent to <span className="font-medium">{email}</span>
            </p>
            <label
              htmlFor="admin-code"
              className="mt-4 block text-sm font-medium text-stone-800"
            >
              Six-digit code
            </label>
            <input
              id="admin-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-center text-lg tracking-[0.35em] text-stone-900 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10"
              placeholder="000000"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Verifying..." : "Verify and sign in"}
          </button>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <button
              type="button"
              onClick={() => void requestCode(email, true)}
              disabled={loading || resendIn > 0}
              className="font-medium text-stone-700 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-stone-400 disabled:no-underline"
            >
              {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
                setStatus("");
                setResendIn(0);
              }}
              className="text-stone-500 underline-offset-4 hover:underline"
            >
              Use a different email
            </button>
          </div>
        </form>
      )}

      <div aria-live="polite" className="mt-4 space-y-2">
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}
        {!error && status ? (
          <p className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
            {status}
          </p>
        ) : null}
      </div>
    </div>
  );
}
