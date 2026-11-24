export const DEV_MEDIA_ORIGIN: string;
export const MEDIA_PATHNAME: string;
export const SUPABASE_IMAGES_PATHNAME: string;

export type RemotePattern = {
  protocol: "http" | "https";
  hostname: string;
  port: string;
  pathname: string;
};

export type MediaOrigin = {
  protocol: "http" | "https";
  hostname: string;
  port: string;
};

export type MediaImageSettings = {
  remotePatterns: RemotePattern[];
  dangerouslyAllowLocalIP: boolean;
  mediaOrigin: MediaOrigin | null;
  warnings: string[];
  productionLike: boolean;
};

export function isProductionLikeBuild(env?: NodeJS.ProcessEnv): boolean;

export function parseMediaOrigin(
  value: string | null | undefined,
): MediaOrigin | null;

export function buildMediaImageSettings(
  env?: NodeJS.ProcessEnv,
): MediaImageSettings;
