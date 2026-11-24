import assert from "node:assert/strict";
import remotePatternModule from "next/dist/shared/lib/match-remote-pattern.js";
import {
  buildMediaRewriteDestination,
  buildMediaImageSettings,
  DEV_MEDIA_ORIGIN,
  LOCAL_IMAGE_PATTERNS,
  MEDIA_PATHNAME,
} from "./media-image-config.mjs";
import { resolveMediaImageSrc } from "../src/lib/mediaImageSrc.ts";

const { matchRemotePattern } = remotePatternModule;
const IMAGE_PATH =
  "products/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp";

function allows(settings, url) {
  return settings.remotePatterns.some((pattern) =>
    matchRemotePattern(pattern, new URL(url)),
  );
}

function mediaPattern(settings) {
  return settings.remotePatterns.find(
    (pattern) => pattern.pathname === MEDIA_PATHNAME,
  );
}

function assertMediaHost(settings, origin) {
  const pattern = mediaPattern(settings);

  assert.ok(pattern, "expected a /media remotePattern");
  assert.equal(
    pattern.hostname,
    new URL(origin).hostname,
    "media hostname must match exactly",
  );
  assert.equal(
    pattern.protocol,
    new URL(origin).protocol.replace(":", ""),
    "media protocol must match exactly",
  );
  assert.equal(
    pattern.port,
    new URL(origin).port,
    "media port must match exactly",
  );
}

const dev = buildMediaImageSettings({ NODE_ENV: "development" });

assert.equal(dev.warnings.length, 0, "dev default must not warn");
assert.equal(dev.dangerouslyAllowLocalIP, true, "dev allows local IPs");
assertMediaHost(dev, DEV_MEDIA_ORIGIN);
assert.equal(mediaPattern(dev)?.search, "", "media queries are not allowed");
assert.deepEqual(
  dev.localPatterns,
  LOCAL_IMAGE_PATTERNS,
  "local patterns must allow only /media/** and /images/** without queries",
);
assert.deepEqual(dev.localPatterns, [
  { pathname: "/media/**", search: "" },
  { pathname: "/images/**", search: "" },
]);
assert.equal(
  buildMediaRewriteDestination({ NODE_ENV: "development" }),
  "http://localhost:4000/media/:path*",
  "local dev must rewrite media to the local API",
);
assert.equal(
  buildMediaRewriteDestination({ NODE_ENV: "production", NEXT_OUTPUT: "standalone" }),
  "http://api:4000/media/:path*",
  "standalone builds must default to the internal API service",
);
assert.equal(
  buildMediaRewriteDestination({
    NODE_ENV: "production",
    NEXT_OUTPUT: "standalone",
    API_INTERNAL_URL: "http://internal-api:4000/",
  }),
  "http://internal-api:4000/media/:path*",
  "explicit internal API URL must be used and trailing slashes removed",
);
assert.equal(
  allows(
    dev,
    `${DEV_MEDIA_ORIGIN}/media/${IMAGE_PATH}?v=1`,
  ),
  false,
  "remote media patterns must reject query strings",
);
assert.equal(
  allows(dev, `${DEV_MEDIA_ORIGIN}/media/${IMAGE_PATH}`),
  true,
  "dev media host must be allowed",
);
assert.equal(
  allows(dev, `${DEV_MEDIA_ORIGIN}/mediaevil/${IMAGE_PATH}`),
  false,
  "only /media/** may be optimized",
);
assert.equal(
  allows(dev, `http://evil.example/media/${IMAGE_PATH}`),
  false,
  "other hosts must be blocked",
);
assert.equal(
  allows(dev, `http://localhost:4001/media/${IMAGE_PATH}`),
  false,
  "other ports must be blocked",
);
assert.equal(
  allows(dev, `https://localhost:4000/media/${IMAGE_PATH}`),
  false,
  "other protocols must be blocked",
);
assert.equal(
  allows(dev, `http://localhost:4000/other/${IMAGE_PATH}`),
  false,
  "other paths must be blocked",
);

const explicit = buildMediaImageSettings({
  NODE_ENV: "development",
  NEXT_PUBLIC_MEDIA_BASE_URL: "https://api.example.com/",
});

assert.equal(explicit.warnings.length, 0);
assertMediaHost(explicit, "https://api.example.com");
assert.equal(
  allows(explicit, `https://api.example.com/media/${IMAGE_PATH}`),
  true,
  "explicit https media host must be allowed",
);
assert.equal(
  allows(explicit, `https://api.example.com.evil.test/media/${IMAGE_PATH}`),
  false,
  "lookalike hosts must be blocked",
);

const productionMissing = buildMediaImageSettings({ NODE_ENV: "production" });

assert.equal(
  productionMissing.dangerouslyAllowLocalIP,
  false,
  "production must not allow local IPs",
);
assert.equal(
  mediaPattern(productionMissing),
  undefined,
  "production without the env var must not add a media pattern",
);
assert.ok(
  productionMissing.warnings.some((warning) =>
    warning.includes("NEXT_PUBLIC_MEDIA_BASE_URL"),
  ),
  "production must warn when the media base URL is missing",
);
assert.equal(
  allows(productionMissing, `${DEV_MEDIA_ORIGIN}/media/${IMAGE_PATH}`),
  false,
  "production must not fall back to localhost",
);

const productionSet = buildMediaImageSettings({
  NODE_ENV: "production",
  NEXT_PUBLIC_MEDIA_BASE_URL: "https://api.example.com",
});

assert.equal(productionSet.dangerouslyAllowLocalIP, false);
assertMediaHost(productionSet, "https://api.example.com");
assert.equal(productionSet.warnings.length, 0);

const standaloneSettings = buildMediaImageSettings({
  NODE_ENV: "production",
  NEXT_OUTPUT: "standalone",
  NEXT_PUBLIC_MEDIA_BASE_URL: "https://api.example.com",
  API_INTERNAL_URL: "http://api:4000",
});

assert.equal(
  standaloneSettings.rewriteDestination,
  "http://api:4000/media/:path*",
  "standalone settings must bake the internal media rewrite",
);

const stagingMissing = buildMediaImageSettings({
  NODE_ENV: "development",
  NEXT_PUBLIC_APP_ENV: "staging",
});

assert.equal(stagingMissing.productionLike, true);
assert.ok(
  stagingMissing.warnings.some((warning) =>
    warning.includes("NEXT_PUBLIC_MEDIA_BASE_URL"),
  ),
  "staging must warn when the media base URL is missing",
);

const badUrl = buildMediaImageSettings({
  NODE_ENV: "production",
  NEXT_PUBLIC_MEDIA_BASE_URL: "not a valid url",
});

assert.equal(
  mediaPattern(badUrl),
  undefined,
  "an invalid media URL must not create a pattern",
);
assert.ok(
  badUrl.warnings.some((warning) =>
    warning.includes("NEXT_PUBLIC_MEDIA_BASE_URL"),
  ),
  "an invalid media URL must warn",
);

const pathUrl = buildMediaImageSettings({
  NODE_ENV: "development",
  NEXT_PUBLIC_MEDIA_BASE_URL: "https://api.example.com/some/path",
});

assert.equal(
  mediaPattern(pathUrl),
  undefined,
  "a media base URL with a path must be rejected",
);

assert.doesNotThrow(() => buildMediaImageSettings({}));

const originalNodeEnv = process.env.NODE_ENV;
const originalMediaBaseUrl = process.env.NEXT_PUBLIC_MEDIA_BASE_URL;

try {
  process.env.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_MEDIA_BASE_URL = "https://shop.example.com";

  assert.equal(
    resolveMediaImageSrc(
      `https://shop.example.com/media/${IMAGE_PATH}`,
    ),
    `/media/${IMAGE_PATH}`,
    "matching absolute media URLs must become site-relative",
  );
  assert.equal(
    resolveMediaImageSrc("/media/" + IMAGE_PATH),
    `/media/${IMAGE_PATH}`,
    "already-relative media URLs stay unchanged",
  );
  assert.equal(
    resolveMediaImageSrc("/images/home/hero-1.jpg"),
    "/images/home/hero-1.jpg",
    "local public images stay unchanged",
  );
  assert.equal(
    resolveMediaImageSrc(
      `https://shop.example.com/media/${IMAGE_PATH}?v=1`,
    ),
    `https://shop.example.com/media/${IMAGE_PATH}?v=1`,
    "media URLs with query strings stay unchanged",
  );
  assert.equal(
    resolveMediaImageSrc(
      `https://cdn.example.com/media/${IMAGE_PATH}`,
    ),
    `https://cdn.example.com/media/${IMAGE_PATH}`,
    "foreign media hosts stay unchanged",
  );
  assert.equal(resolveMediaImageSrc(null), undefined);

  process.env.NODE_ENV = "development";
  delete process.env.NEXT_PUBLIC_MEDIA_BASE_URL;

  assert.equal(
    resolveMediaImageSrc(`http://localhost:4000/media/${IMAGE_PATH}`),
    `/media/${IMAGE_PATH}`,
    "development must convert the default local API media URL",
  );
} finally {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }

  if (originalMediaBaseUrl === undefined) {
    delete process.env.NEXT_PUBLIC_MEDIA_BASE_URL;
  } else {
    process.env.NEXT_PUBLIC_MEDIA_BASE_URL = originalMediaBaseUrl;
  }
}

assert.equal(
  dev.remotePatterns.length,
  1,
  "only the /media pattern may remain",
);
assert.equal(
  productionSet.remotePatterns.length,
  1,
  "production must expose only the /media pattern",
);

console.log(
  `media image config OK (${dev.remotePatterns.length} dev pattern${
    dev.remotePatterns.length === 1 ? "" : "s"
  }, ${productionSet.remotePatterns.length} production pattern${
    productionSet.remotePatterns.length === 1 ? "" : "s"
  })`,
);
