"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import {
  PUBLIC_CATEGORIES_TAG,
  PUBLIC_CONTENT_TAG,
  PUBLIC_SETTINGS_TAG,
} from "@/lib/publicApi";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function revalidateStorefront(): Promise<{
  ok: boolean;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { ok: false };
    }

    revalidateTag(PUBLIC_SETTINGS_TAG, { expire: 0 });
    revalidateTag(PUBLIC_CONTENT_TAG, { expire: 0 });
    revalidateTag(PUBLIC_CATEGORIES_TAG, { expire: 0 });
    revalidatePath("/", "layout");

    return { ok: true };
  } catch {
    return { ok: false };
  }
}
