"use client";

import { useState, type FormEvent } from "react";
import { ArrowRightIcon } from "@/components/design/icons";

/**
 * Kept ready for the newsletter feature flag. Do not enable until a real
 * signup endpoint with consent handling exists.
 */
export function NewsletterForm() {
  const [message, setMessage] = useState("");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("Newsletter signup is not available yet.");
  }

  return (
    <>
      <form className="zf-newsletter" onSubmit={onSubmit}>
        <label className="zf-sr-only" htmlFor="zf-newsletter-email">
          Email address
        </label>
        <input
          id="zf-newsletter-email"
          name="email"
          type="email"
          required
          placeholder="Email address"
          autoComplete="email"
        />
        <button type="submit" aria-label="Subscribe to the newsletter">
          <ArrowRightIcon aria-hidden="true" />
        </button>
      </form>
      <p aria-live="polite" style={{ marginTop: 10, minHeight: 18 }}>
        {message}
      </p>
    </>
  );
}
