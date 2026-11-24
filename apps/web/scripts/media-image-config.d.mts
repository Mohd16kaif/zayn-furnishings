export const DEV_MEDIA_ORIGIN: string;
export const MEDIA_PATHNAME: string;
export const LOCAL_IMAGE_PATTERNS: Array<{
  pathname: string;
  search: string;
}>;

export type RemotePattern = {
  protocol: "http" | "https";
  hostname: string;
  port: string;
  pathname: string;
  search?: string;
};

export type MediaOrigin = {
  protocol: "http" | "https";
  hostname: string;
  port: string;
};

export type MediaImageSettings = {
  remotePatterns: RemotePattern[];
  localPatterns: Array<{ pathname: string; search: string }>;
  rewriteDestination: string;
  dangerouslyAllowLocalIP: boolean;
  mediaOrigin: MediaOrigin | null;
  warnings: string[];
  productionLike: boolean;
};

export function isProductionLikeBuild(env?: NodeJS.ProcessEnv): boolean;

export function parseMediaOrigin(
  value: string | null | undefined,
): MediaOrigin | null;

export function buildInternalApiBase(env?: NodeJS.ProcessEnv): string;

export function buildMediaRewriteDestination(
  env?: NodeJS.ProcessEnv,
): string;

export function buildMediaImageSettings(
  env?: NodeJS.ProcessEnv,
): MediaImageSettings;
