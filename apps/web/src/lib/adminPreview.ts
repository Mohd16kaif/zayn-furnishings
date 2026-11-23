import { getCurrentAdmin } from "@/lib/adminServer";

export async function hasAdminPreviewSession(): Promise<boolean> {
  const admin = await getCurrentAdmin({ timeoutMs: 2_500 });

  return admin !== null;
}
