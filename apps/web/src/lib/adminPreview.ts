import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function hasAdminPreviewSession(): Promise<boolean> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return false;
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    return Boolean(session?.user);
  } catch {
    return false;
  }
}
