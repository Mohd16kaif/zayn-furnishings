import assert from "node:assert/strict";
import remotePatternModule from "next/dist/shared/lib/match-remote-pattern.js";
import {
  buildMediaImageSettings,
  DEV_MEDIA_ORIGIN,
  MEDIA_PATHNAME,
} from "./media-image-config.mjs";

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
