"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { SessionCustomer } from "@/lib/customer";
import { useCustomer } from "@/components/design/customer-provider";

type SignInProps = {
  onSignedIn?: (customer: SessionCustomer) => void;
  heading?: string;
  showSmsOptIn?: boolean;
  smsOptIn?: boolean;
  onSmsOptInChange?: (checked: boolean) => void;
};

const RESEND_SECONDS = 30;

function waitMessage(seconds: number): string {
  return `Too many attempts. Please try again in ${Math.max(
    1,
    seconds,
  )} second${seconds === 1 ? "" : "s"}.`;
}

function errorFor(status: number, message: string | null): string {
  if (status === 400) {
    return message || "Enter a valid US phone number.";
  }

  if (status === 429) {
    return message || "Too many attempts. Please wait a moment.";
  }

  if (status === 503) {
    return "Text sign-in is temporarily unavailable. Please try again in a moment.";
  }

  return message || "Something went wrong. Please try again.";
}

export function SignIn({
  onSignedIn,
  heading = "Sign in",
  showSmsOptIn = false,
  smsOptIn = false,
  onSmsOptInChange,
}: SignInProps) {
  const router = useRouter();
  const { setCustomer } = useCustomer();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [devMode, setDevMode] = useState(false);
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step !== "code" || cooldown <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setCooldown((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [step, cooldown]);

  useEffect(() => {
    if (step === "code") {
      codeRef.current?.focus();
    }
  }, [step]);

  async function readJson(response: Response): Promise<Record<string, unknown>> {
    const data: unknown = await response.json().catch(() => null);

    return typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)
      : {};
  }

  async function startVerification(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (busy) {
      return;
    }

    const trimmed = phone.trim();

    if (!trimmed) {
      setError("Enter your phone number.");
      phoneRef.current?.focus();
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/auth/phone-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: trimmed }),
      });
      const data = await readJson(response);

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = Number(
            response.headers.get("Retry-After") ?? 0,
          );

          setCooldown(Number.isFinite(retryAfter) ? retryAfter : 30);
          setError(
            waitMessage(
              Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter
                : 30,
            ),
          );
        } else {
          setError(
            errorFor(
              response.status,
              typeof data.error === "string" ? data.error : null,
            ),
          );
        }

        return;
      }

      setStep("code");
      setCode("");
      setCooldown(RESEND_SECONDS);
      setDevMode(data.dev_mode === true);
      setNotice(
        "We sent a 6-digit code. Enter it below to continue.",
      );
    } catch {
      setError(
        "We could not reach sign-in. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy) {
      return;
    }

    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your text message.");
      codeRef.current?.focus();
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/auth/phone-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), code }),
      });
      const data = await readJson(response);

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = Number(
            response.headers.get("Retry-After") ?? 0,
          );

          setError(
            waitMessage(
              Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter
                : 30,
            ),
          );
        } else if (response.status === 400) {
          setError(
            typeof data.error === "string"
              ? data.error
              : "That code is incorrect or expired.",
          );
        } else {
          setError(
            errorFor(
              response.status,
              typeof data.error === "string" ? data.error : null,
            ),
          );
        }

        return;
      }

      const customer = data.customer;

      if (
        typeof customer !== "object" ||
        customer === null ||
        typeof (customer as SessionCustomer).phone_masked !== "string"
      ) {
        setError("Sign-in could not be completed. Please try again.");
        return;
      }

      setCustomer(customer as SessionCustomer);
      setNotice("Signed in.");
      onSignedIn?.(customer as SessionCustomer);

      if (!onSignedIn) {
        router.refresh();
      }
    } catch {
      setError(
        "We could not reach sign-in. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function changeNumber() {
    setStep("phone");
    setCode("");
    setError("");
    setNotice("");
    setCooldown(0);
    requestAnimationFrame(() => phoneRef.current?.focus());
  }

  return (
    <div className="zf-signin">
      <h2 className="zf-signin__title">{heading}</h2>

      {step === "phone" ? (
        <form className="zf-signin__form" onSubmit={startVerification}>
          <div className="zf-field">
            <label className="zf-field__label" htmlFor="signin-phone">
              Phone number
            </label>
            <input
              ref={phoneRef}
              id="signin-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              className="zf-input"
              placeholder="(555) 555-0100"
              value={phone}
              disabled={busy}
              onChange={(event) => {
                setPhone(event.target.value);
                setError("");
                setNotice("");
              }}
            />
            <p className="zf-field__help">
              We will text you a 6-digit code.
            </p>
          </div>

          {showSmsOptIn ? (
            <div className="zf-checkbox">
              <input
                id="signin-sms-opt-in"
                name="sms_opt_in"
                type="checkbox"
                checked={smsOptIn}
                disabled={busy}
                onChange={(event) => {
                  onSmsOptInChange?.(event.target.checked);
                }}
              />
              <label htmlFor="signin-sms-opt-in">
                Text me occasional offers and updates from Zayn Furnishings.
                Consent is not a condition of purchase. Message and data rates
                may apply. Reply STOP to opt out. See our{" "}
                <Link href="/terms">Terms</Link> and{" "}
                <Link href="/privacy">Privacy Policy</Link>.
              </label>
            </div>
          ) : null}

          <div className="zf-form__feedback" aria-live="polite">
            {error ? (
              <p className="zf-form__error" role="alert">
                {error}
              </p>
            ) : notice ? (
              <p className="zf-form__notice">{notice}</p>
            ) : null}
          </div>

          <button
            type="submit"
            className="zf-btn zf-btn--primary zf-signin__submit"
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Sending code…" : "Send code"}
          </button>
        </form>
      ) : (
        <form className="zf-signin__form" onSubmit={verify}>
          <div className="zf-field">
            <label className="zf-field__label" htmlFor="signin-code">
              6-digit code
            </label>
            <input
              ref={codeRef}
              id="signin-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              className="zf-input zf-input--code"
              placeholder="000000"
              value={code}
              disabled={busy}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                setError("");
              }}
            />
            <p className="zf-field__help">
              Sent to {phone.trim()}.
            </p>
          </div>

          {devMode ? (
            <p className="zf-signin__dev-note">
              Dev mode: use code 123456
            </p>
          ) : null}

          <div className="zf-form__feedback" aria-live="polite">
            {error ? (
              <p className="zf-form__error" role="alert">
                {error}
              </p>
            ) : notice ? (
              <p className="zf-form__notice">{notice}</p>
            ) : null}
          </div>

          <button
            type="submit"
            className="zf-btn zf-btn--primary zf-signin__submit"
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Verifying…" : "Verify and sign in"}
          </button>

          <div className="zf-signin__links">
            <button
              type="button"
              className="zf-link-button"
              disabled={busy || cooldown > 0}
              onClick={() => void startVerification()}
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </button>
            <button
              type="button"
              className="zf-link-button"
              disabled={busy}
              onClick={changeNumber}
            >
              Change number
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
