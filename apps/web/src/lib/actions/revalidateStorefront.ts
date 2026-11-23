"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { getCurrentAdmin } from "@/lib/adminServer";
import {
  PUBLIC_CATEGORIES_TAG,
  PUBLIC_CONTENT_TAG,
  PUBLIC_SETTINGS_TAG,
} from "@/lib/publicApi";

export async function revalidateStorefront(): Promise<{
  ok: boolean;
}> {
  try {
    const admin = await getCurrentAdmin({ timeoutMs: 2_500 });

    if (!admin) {
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
