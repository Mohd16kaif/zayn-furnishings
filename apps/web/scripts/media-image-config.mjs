// @ts-check
import process from "node:process";

export const DEV_MEDIA_ORIGIN = "http://localhost:4000";
export const MEDIA_PATHNAME = "/media/**";

/**
 * @typedef {Object} RemotePattern
 * @property {"http" | "https"} protocol
 * @property {string} hostname
 * @property {string} port
 * @property {string} pathname
 */

/**
 * @typedef {Object} MediaOrigin
 * @property {"http" | "https"} protocol
 * @property {string} hostname
 * @property {string} port
 */

function envValue(env, key) {
  const value = env[key];

  return typeof value === "string" ? value.trim() : "";
}

/**
 * Next.js sets NODE_ENV=production for both staging and production builds.
 * NEXT_PUBLIC_APP_ENV is checked as well so a staging build run locally still
 * gets the production warning.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
export function isProductionLikeBuild(env = process.env) {
  const appEnv = envValue(env, "NEXT_PUBLIC_APP_ENV").toLowerCase();

  if (appEnv === "staging" || appEnv === "production") {
    return true;
  }

  return envValue(env, "NODE_ENV") === "production";
}

/**
 * Parse an http(s) origin. A trailing slash is allowed; credentials, query
 * strings, fragments, and paths are rejected so remotePatterns stay exact.
 *
 * @param {string | null | undefined} value
 * @returns {MediaOrigin | null}
 */
export function parseMediaOrigin(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  let url;

  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  if (url.username || url.password || url.search || url.hash) {
    return null;
  }

  if (url.pathname !== "/" && url.pathname !== "") {
    return null;
  }

  if (!url.hostname) {
    return null;
  }

  return {
    protocol: url.protocol === "http:" ? "http" : "https",
    hostname: url.hostname,
    port: url.port,
  };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function buildMediaImageSettings(env = process.env) {
  const productionLike = isProductionLikeBuild(env);
  const configured = envValue(env, "NEXT_PUBLIC_MEDIA_BASE_URL");
  const warnings = [];
  let mediaOrigin = configured ? parseMediaOrigin(configured) : null;

  if (configured && !mediaOrigin) {
    warnings.push(
      "NEXT_PUBLIC_MEDIA_BASE_URL is not a valid http(s) origin. Media images will not be optimized; use the API's public origin with no path.",
    );
  }

  if (!configured && productionLike) {
    warnings.push(
      "NEXT_PUBLIC_MEDIA_BASE_URL is not set. Staging and production builds must set it to the API's public media origin (the same value as MEDIA_PUBLIC_BASE_URL) so /media images can be optimized.",
    );
  }

  if (!configured && !productionLike) {
    mediaOrigin = parseMediaOrigin(DEV_MEDIA_ORIGIN);
  }

  /** @type {RemotePattern[]} */
  const remotePatterns = [];

  if (mediaOrigin) {
    remotePatterns.push({
      protocol: mediaOrigin.protocol,
      hostname: mediaOrigin.hostname,
      port: mediaOrigin.port,
      pathname: MEDIA_PATHNAME,
    });
  }

  return {
    remotePatterns,
    dangerouslyAllowLocalIP: envValue(env, "NODE_ENV") !== "production",
    mediaOrigin,
    warnings,
    productionLike,
  };
}
