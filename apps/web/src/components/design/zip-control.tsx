"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { CloseIcon } from "./icons";

const ZIP_COOKIE = "zf-zip";

function readZipCookie(): string | null {
  try {
    const match = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${ZIP_COOKIE}=`));

    return match ? match.split("=")[1] : null;
  } catch {
    return null;
  }
}

function subscribeCookie(callback: () => void) {
  // Cookies have no change events; re-read when the window regains focus.
  window.addEventListener("focus", callback);
  return () => window.removeEventListener("focus", callback);
}

function getZipSnapshot(): string | null {
  return readZipCookie();
}

function getZipServerSnapshot(): string | null {
  return null;
}

/**
 * "Delivering to <ZIP>" utility control. POSTs the ZIP to /api/zip-check
 * (server-side proxy of the public delivery check) and stores the ZIP in a
 * cookie set by the route handler (only for ZIPs we can deliver to).
 * The ZIP value never appears in URLs.
 */
export function ZipControl() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const savedZip = useSyncExternalStore(
    subscribeCookie,
    getZipSnapshot,
    getZipServerSnapshot,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function openPanel() {
    setNote("");
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function closePanel() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const zip = value.trim();

    if (!/^\d{5}$/.test(zip)) {
      setNote("Please enter a 5-digit ZIP code.");
      return;
    }

    setBusy(true);

    try {
      const response = await fetch("/api/zip-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zip }),
      });

      if (!response.ok) {
        setNote(
          response.status === 400
            ? "Please enter a 5-digit ZIP code."
            : "Sorry, we could not check that ZIP. Please try again.",
        );
        return;
      }

      const data: { available?: boolean } = await response
        .json()
        .catch(() => ({}));

      if (data.available === true) {
        closePanel();
        return;
      }

      setNote("We don't deliver there yet.");
    } catch {
      setNote("Sorry, we could not check that ZIP. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const label = savedZip ? `Delivering to ${savedZip}` : "Delivery";

  return (
    <div className="zf-zip">
      <button
        ref={triggerRef}
        type="button"
        className="zf-zip__trigger"
        aria-expanded={open}
        aria-controls="zf-zip-popover"
        onClick={() => (open ? closePanel() : openPanel())}
      >
        {label}
      </button>

      <div
        id="zf-zip-popover"
        className={`zf-zip__panel${open ? " is-open" : ""}`}
        role="dialog"
        aria-label="Check delivery ZIP"
      >
        <div className="zf-zip__head">
          <span>Delivery ZIP</span>
          <button
            type="button"
            className="zf-icon-btn"
            aria-label="Close ZIP popover"
            onClick={closePanel}
          >
            <CloseIcon />
          </button>
        </div>

        <form className="zf-zip__form" onSubmit={onSubmit}>
          <label className="zf-sr-only" htmlFor="zf-zip-input">
            5-digit ZIP code
          </label>
          <input
            ref={inputRef}
            id="zf-zip-input"
            name="zip"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={5}
            placeholder="e.g. 10001"
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/\D/g, ""))}
            disabled={busy}
          />
          <button type="submit" disabled={busy}>
            Check
          </button>
        </form>

        <p aria-live="polite" className="zf-zip__note">
          {note || "Find out if we deliver to you."}
        </p>
      </div>
    </div>
  );
}
