import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";

let adminClient: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

function requireSupabaseUrl(): string {
  if (!env.SUPABASE_URL) {
    throw new Error("SUPABASE_URL is not configured");
  }

  return env.SUPABASE_URL;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  if (!adminClient) {
    adminClient = createClient(
      requireSupabaseUrl(),
      env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }

  return adminClient;
}

export function getSupabaseAnon(): SupabaseClient {
  if (!env.SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_ANON_KEY is not configured");
  }

  if (!anonClient) {
    anonClient = createClient(requireSupabaseUrl(), env.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return anonClient;
}
