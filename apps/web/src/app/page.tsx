"use client";

import { useEffect, useState } from "react";
import type { HealthResponse } from "@zayn/shared";

type FetchState =
  | { status: "loading" }
  | { status: "success"; data: HealthResponse }
  | { status: "error"; message: string; url: string };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function Home() {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function checkApi() {
      try {
        const response = await fetch(`${apiUrl}/health`, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const data = (await response.json()) as HealthResponse;

        if (!cancelled) {
          setState({ status: "success", data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unknown error",
            url: `${apiUrl}/health`,
          });
        }
      }
    }

    checkApi();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">Store setup OK</h1>
      <p className="text-sm text-gray-500">
        Zayn Furnishings &mdash; API connectivity check
      </p>
      <p className="text-sm text-gray-500">
        API URL: <code>{apiUrl}/health</code>
      </p>
      <pre className="w-full max-w-xl overflow-x-auto rounded-lg bg-gray-100 p-4 text-sm dark:bg-gray-900">
        {state.status === "loading" && `Checking ${apiUrl}/health...`}
        {state.status === "success" &&
          `db: ${state.data.db}\n${JSON.stringify(state.data, null, 2)}`}
        {state.status === "error" &&
          `API error: ${state.message}\nTried: ${state.url}`}
      </pre>
    </main>
  );
}
