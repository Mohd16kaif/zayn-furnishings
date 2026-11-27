import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const WEB_ROOT = path.join(REPO_ROOT, "apps", "web");
const PUBLIC_ROOT = path.join(WEB_ROOT, "public");
const SRC_ROOT = path.join(WEB_ROOT, "src");
const requireWeb = createRequire(path.join(WEB_ROOT, "package.json"));
const { chromium } = requireWeb("@playwright/test");

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");
let TOKEN = process.env.ADMIN_SESSION_TOKEN;
const LABEL = valueFor("--label") || "run";
const WIDTHS = [360, 390, 1280];
const ADMIN_WIDTHS = [390, 1280];
const DATE = new Date();
const DATE_LABEL = `${DATE.getFullYear()}-${String(DATE.getMonth() + 1).padStart(2, "0")}-${String(DATE.getDate()).padStart(2, "0")}`;
const RAW_PATH = path.join(REPO_ROOT, "reports", `${DATE_LABEL}-audit-raw.json`);
const PROGRESS = process.env.AUDIT_PROGRESS === "1";

function progress(message) {
  if (PROGRESS) {
    console.error(`[audit] ${message}`);
  }
}

const STATIC_ROUTES = [
  "/",
  "/about",
  "/contact",
  "/faq",
  "/delivery",
  "/returns",
  "/privacy",
  "/terms",
  "/accessibility",
  "/cart",
  "/account",
  "/wishlist",
  "/sale",
  "/new",
  "/search",
  "/checkout",
  "/404",
  "/design-preview",
  "/order/ZF-000000",
  "/search?q=sofa",
];

const ADMIN_ROUTES = [
  "/admin/login",
  "/admin",
  "/admin/orders",
  "/admin/products",
  "/admin/categories",
  "/admin/content",
  "/admin/delivery",
  "/admin/settings",
];

const PLACEHOLDER_PATTERNS = [
  ["lorem", /lorem ipsum/i],
  ["SAMPLE", /\bsample\b/i],
  ["TODO", /\bTODO\b/],
  ["FIXME", /\bFIXME\b/],
  ["coming soon", /coming soon/i],
  ["placeholder", /placeholder/i],
  ["example.com", /example\.com/i],
  ["test@", /test@/i],
  ["your text here", /your text here/i],
  ["555", /(?:\(?555\)?[-.\s]?\d{3}[-.\s]?\d{4}|\b555[- ]?\d{4}\b)/],
  ["default Next text", /(Learn Next\.js|Get started by editing|Welcome to Next\.js|Hello world)/i],
  ["default Tailwind text", /(tailwind|utility-first)/i],
];

const CLAIM_PATTERNS = [
  ["warranty", /\bwarranty\b/i],
  ["white-glove", /\bwhite[-\s]?glove\b/i],
  ["financing days/years", /\bfinanc\w*\b[^.\n]{0,80}\b\d+\s*(?:days?|years?|months?)\b/i],
  ["free shipping", /\bfree\s+shipping\b/i],
  ["free delivery", /\bfree\s+(?:standard\s+)?delivery\b/i],
  ["return window", /\breturns?\b[^.\n]{0,80}\b\d+\s*days?\b/i],
  ["numbered warranty", /\b\d+\s*(?:year|years)\b[^.\n]{0,60}\bwarranty\b/i],
];

function valueFor(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function mintDevAdminToken() {
  const databaseUrl =
    process.env.AUDIT_DATABASE_URL || process.env.DATABASE_URL;
  const ownerEmail =
    process.env.AUDIT_OWNER_EMAIL || process.env.OWNER_EMAIL;

  if (!databaseUrl || !ownerEmail) {
    throw new Error(
      "Admin session token is unavailable. Set ADMIN_SESSION_TOKEN or AUDIT_DATABASE_URL/AUDIT_OWNER_EMAIL for a throwaway dev session.",
    );
  }

  const args = [
    "--filter",
    "@zayn/api",
    "admin:mint-dev-session",
  ];
  const result =
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec || "cmd.exe",
          ["/d", "/s", "/c", `pnpm ${args.join(" ")}`],
          {
            cwd: REPO_ROOT,
            env: {
              ...process.env,
              DATABASE_URL: databaseUrl,
              DATABASE_SSL: "disable",
              APP_ENV: "development",
              NODE_ENV: "development",
              OWNER_EMAIL: ownerEmail,
            },
            encoding: "utf8",
            timeout: 120_000,
          },
        )
      : spawnSync("pnpm", args, {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
            DATABASE_SSL: "disable",
            APP_ENV: "development",
            NODE_ENV: "development",
            OWNER_EMAIL: ownerEmail,
          },
          encoding: "utf8",
          timeout: 120_000,
        });

  if (result.error || result.status !== 0) {
    throw new Error(
      "Could not mint the throwaway admin session. The token was not printed.",
    );
  }

  const token = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9_-]{40,}$/.test(line))
    .pop();

  if (!token) {
    throw new Error(
      "The throwaway admin session output did not contain a usable token.",
    );
  }

  // Deliberately do not log or return this value anywhere except the in-memory
  // cookie below.
  return token;
}

function safeName(value) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "root";
}

function text(value, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function percent(part, total) {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 10;
}

async function fetchText(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "zayn-launch-audit/1.0" },
    });
    return { ok: response.ok, status: response.status, finalUrl: response.url, body: await response.text() };
  } catch (error) {
    return { ok: false, status: null, finalUrl: url, body: "", error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = 30000) {
  const result = await fetchText(url, timeoutMs);
  if (!result.ok) return { ...result, data: null };
  try {
    return { ...result, data: JSON.parse(result.body) };
  } catch {
    return { ...result, data: null };
  }
}

async function linkStatus(href, base) {
  let current = href;
  const chain = [];
  for (let hop = 0; hop < 6; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "zayn-launch-audit/1.0" },
      });
    } catch (error) {
      clearTimeout(timer);
      return { href, status: null, chain, error: error instanceof Error ? error.message : String(error) };
    }
    clearTimeout(timer);
    chain.push({ url: current, status: response.status, location: response.headers.get("location") });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { href, status: response.status, chain, error: "redirect without location" };
      current = new URL(location, current).toString();
      if (!current.startsWith(base)) return { href, status: response.status, chain, error: `redirected off-site to ${current}` };
      continue;
    }
    return { href, status: response.status, chain, finalUrl: current };
  }
  return { href, status: 310, chain, error: "redirect loop or too many redirects" };
}

async function externalStatus(href) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(href, { method: "HEAD", redirect: "follow", signal: controller.signal });
    return { href, status: response.status };
  } catch (error) {
    return { href, status: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function categoryPaths(data) {
  const paths = [];
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node?.slug) paths.push(`/c/${node.slug}`);
      walk(node?.children);
    }
  };
  walk(data);
  return paths;
}

async function discoverDataRoutes() {
  const [categories, products, sitemap] = await Promise.all([
    fetchJson(`${API_URL}/api/public/categories`),
    fetchJson(`${API_URL}/api/public/products?page_size=12&sort=newest`),
    fetchText(`${BASE_URL}/sitemap.xml`),
  ]);
  const routes = new Set(STATIC_ROUTES);
  for (const item of categoryPaths(categories.data)) routes.add(item);
  for (const item of (products.data?.items ?? [])) {
    if (item?.slug) routes.add(`/p/${item.slug}`);
  }
  if (products.data?.items?.[0]?.slug) {
    routes.add(`/p/${products.data.items[0].slug}`);
  }
  const productSlugs = [];
  for (const match of sitemap.body.matchAll(/<loc>(.*?)<\/loc>/g)) {
    try {
      const parsed = new URL(match[1].replace(/&amp;/g, "&"));
      if (parsed.origin === new URL(BASE_URL).origin) routes.add(parsed.pathname + parsed.search);
    } catch {
      // Ignore malformed sitemap entries.
    }
  }
  for (const item of (products.data?.items ?? [])) {
    if (item?.slug) productSlugs.push(`/p/${item.slug}`);
  }
  return { routes, productSlugs, categoriesOk: categories.ok, productsOk: products.ok, sitemapStatus: sitemap.status };
}

function internalHref(href, base) {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed === "#" || trimmed.startsWith("#")) return null;
  if (/^(mailto:|tel:)/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, base);
    if (url.origin !== new URL(base).origin) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

async function collectAnchors(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((anchor) => ({
    href: anchor.getAttribute("href") || "",
    resolved: anchor.href,
    text: (anchor.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
    visible: Boolean(anchor.offsetWidth || anchor.offsetHeight || anchor.getClientRects().length),
    ariaLabel: anchor.getAttribute("aria-label"),
    target: anchor.getAttribute("target"),
    rel: anchor.getAttribute("rel"),
  })));
}

function recorder(page) {
  const state = { consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [], badResponses: [] };
  page.on("console", (message) => {
    const entry = { type: message.type(), text: text(message.text(), 500) };
    if (message.type() === "error") state.consoleErrors.push(entry);
    if (message.type() === "warning") state.consoleWarnings.push(entry);
  });
  page.on("pageerror", (error) => state.pageErrors.push(text(error.message, 500)));
  page.on("requestfailed", (request) => {
    state.requestFailures.push({ url: request.url(), failure: request.failure()?.errorText ?? "failed" });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) state.badResponses.push({ status: response.status(), url: response.url() });
  });
  return {
    reset() {
      for (const key of Object.keys(state)) state[key].length = 0;
    },
    snapshot() {
      return {
        consoleErrors: [...state.consoleErrors].slice(0, 30),
        consoleWarnings: [...state.consoleWarnings].slice(0, 30),
        pageErrors: [...state.pageErrors].slice(0, 30),
        requestFailures: [...state.requestFailures].slice(0, 30),
        badResponses: [...state.badResponses].slice(0, 30),
      };
    },
  };
}

async function auditPage({ context, page, recorder: rec, route, width, kind }) {
  await page.setViewportSize({ width, height: 900 });
  rec.reset();
  let response = null;
  let navigationError = null;
  try {
    response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page
      .locator("header, main, footer, form, h1")
      .first()
      .waitFor({ timeout: 8000 })
      .catch(() => undefined);
    await page.waitForTimeout(300);
    await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  } catch (error) {
    navigationError = error instanceof Error ? error.message : String(error);
  }

  const data = await page.evaluate(() => {
    const maxText = 250000;
    const viewportWidth = window.innerWidth;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const elementPath = (element) => {
      if (!element || element === document.body) return "body";
      const parts = [];
      let current = element;
      for (let depth = 0; current && current !== document.body && depth < 4; depth += 1) {
        let part = current.tagName.toLowerCase();
        if (current.id) part += `#${current.id}`;
        else if (current.classList && current.classList.length) part += `.${Array.from(current.classList).slice(0, 2).join(".")}`;
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(" > ");
    };
    const meta = (selector, attr = "content") => document.querySelector(selector)?.getAttribute(attr) ?? null;
    const title = document.title || "";
    const description = meta('meta[name="description"]');
    const h1s = Array.from(document.querySelectorAll("h1")).map((node) => (node.textContent || "").replace(/\s+/g, " ").trim());
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
    const robotsMeta = meta('meta[name="robots"]');
    const og = Array.from(document.querySelectorAll('meta[property^="og:"]')).map((node) => ({
      property: node.getAttribute("property"),
      content: node.getAttribute("content"),
    }));
    const twitter = Array.from(document.querySelectorAll('meta[name^="twitter:"]')).map((node) => ({
      name: node.getAttribute("name"),
      content: node.getAttribute("content"),
    }));
    const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((node) => {
      const raw = node.textContent || "";
      try {
        const parsed = JSON.parse(raw);
        return { valid: true, type: Array.isArray(parsed) ? "array" : parsed?.["@type"] ?? "object", length: raw.length };
      } catch (error) {
        return { valid: false, error: error instanceof Error ? error.message : String(error), length: raw.length };
      }
    });
    const icons = Array.from(document.querySelectorAll('link[rel*="icon" i]')).map((node) => ({
      rel: node.getAttribute("rel"),
      href: node.getAttribute("href"),
      sizes: node.getAttribute("sizes"),
    }));
    const bodyText = (document.body?.innerText || "").slice(0, maxText);
    const lowerText = bodyText.toLowerCase();
    const overflow = document.documentElement.scrollWidth <= viewportWidth;
    const overflowOffenders = overflow ? [] : Array.from(document.querySelectorAll("body *"))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ element, rect }) => visible(element) && (rect.right > viewportWidth + 1 || rect.left < -1))
      .sort((a, b) => Math.max(b.rect.right - viewportWidth, -b.rect.left) - Math.max(a.rect.right - viewportWidth, -a.rect.left))
      .slice(0, 20)
      .map(({ element, rect }) => ({
        selector: elementPath(element),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      }));
    const interactiveSelector = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
    const interactive = Array.from(document.querySelectorAll(interactiveSelector)).filter(visible);
    const smallTargets = interactive.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        selector: elementPath(element),
        tag: element.tagName.toLowerCase(),
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        text: ((element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/g, " ").trim()).slice(0, 80),
      };
    }).filter((item) => item.width < 44 || item.height < 44).slice(0, 80);
    const overlapTargets = [];
    for (let i = 0; i < Math.min(interactive.length, 120); i += 1) {
      for (let j = i + 1; j < Math.min(interactive.length, 120); j += 1) {
        const a = interactive[i].getBoundingClientRect();
        const b = interactive[j].getBoundingClientRect();
        const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapWidth > 2 && overlapHeight > 2) {
          overlapTargets.push({
            a: elementPath(interactive[i]),
            b: elementPath(interactive[j]),
            area: Math.round(overlapWidth * overlapHeight),
          });
          if (overlapTargets.length >= 20) break;
        }
      }
      if (overlapTargets.length >= 20) break;
    }
    const anchors = Array.from(document.querySelectorAll("a[href]")).map((anchor) => ({
      href: anchor.getAttribute("href") || "",
      text: (anchor.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      visible: visible(anchor),
      ariaLabel: anchor.getAttribute("aria-label"),
    }));
    const forms = Array.from(document.querySelectorAll("form")).map((form) => ({
      selector: elementPath(form),
      action: form.getAttribute("action"),
      method: form.getAttribute("method"),
      controls: Array.from(form.querySelectorAll("input, select, textarea, button")).map((control) => ({
        tag: control.tagName.toLowerCase(),
        type: control.getAttribute("type"),
        name: control.getAttribute("name"),
        id: control.id,
        autocomplete: control.getAttribute("autocomplete"),
        inputmode: control.getAttribute("inputmode"),
        required: control.hasAttribute("required"),
        disabled: control.hasAttribute("disabled"),
        text: (control.getAttribute("aria-label") || control.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      })),
    }));
    const images = Array.from(document.querySelectorAll("img")).map((image) => ({
      src: image.currentSrc || image.src,
      alt: image.getAttribute("alt"),
      width: image.getAttribute("width"),
      height: image.getAttribute("height"),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      complete: image.complete,
      loading: image.getAttribute("loading"),
      fetchPriority: image.getAttribute("fetchpriority"),
    }));
    const imageResources = performance.getEntriesByType("resource")
      .filter((entry) => entry.initiatorType === "img" || /\.(png|jpe?g|webp|gif|avif|svg)(\?|$)/i.test(entry.name))
      .map((entry) => ({ name: entry.name, transferSize: Math.round(entry.transferSize || 0), decodedBodySize: Math.round(entry.decodedBodySize || 0) }))
      .filter((entry) => entry.transferSize > 0);
    const priceNumbers = Array.from(document.querySelectorAll("body *")).filter((element) => {
      if (element.children.length > 0) return false;
      const sample = (element.textContent || "").trim();
      return /^\$?\d[\d,]*(?:\.\d{2})?$/.test(sample) || /price|total|quantity|qty|subtotal/i.test(element.className || "");
    }).slice(0, 200).map((element) => ({
      selector: elementPath(element),
      value: (element.textContent || "").trim().slice(0, 40),
      fontVariantNumeric: getComputedStyle(element).fontVariantNumeric,
      fontFeatureSettings: getComputedStyle(element).fontFeatureSettings,
    }));
    const priceMissingTabular = priceNumbers.filter((item) => !/tabular-nums/.test(item.fontVariantNumeric) && !/tnum/.test(item.fontFeatureSettings)).slice(0, 40);
    const textWrap = ["h1", "h2", "h3", "p"].flatMap((tag) => Array.from(document.querySelectorAll(tag)).slice(0, 60).map((element) => ({
      tag,
      selector: elementPath(element),
      text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      textWrap: getComputedStyle(element).textWrap || getComputedStyle(element).textWrapStyle,
    }))).slice(0, 120);
    const fixedSticky = Array.from(document.querySelectorAll("body *")).filter((element) => {
      const position = getComputedStyle(element).position;
      return position === "fixed" || position === "sticky";
    }).slice(0, 40).map((element) => {
      const style = getComputedStyle(element);
      return {
        selector: elementPath(element),
        position: style.position,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        top: style.top,
        bottom: style.bottom,
      };
    });
    const viewportMeta = document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null;
    const disabledControls = Array.from(document.querySelectorAll("button:disabled, input:disabled, select:disabled, textarea:disabled, [aria-disabled=true]"))
      .filter(visible)
      .slice(0, 40)
      .map((element) => ({
        selector: elementPath(element),
        tag: element.tagName.toLowerCase(),
        text: ((element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/g, " ").trim()).slice(0, 100),
      }));
    const soonControls = Array.from(document.querySelectorAll("button, a, [role=button]"))
      .filter(visible)
      .filter((element) => /soon/i.test(element.textContent || "") || /soon/i.test(element.getAttribute("aria-label") || ""))
      .slice(0, 40)
      .map((element) => ({ selector: elementPath(element), text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100) }));
    return {
      title,
      titleLength: title.length,
      description,
      descriptionLength: description ? description.length : 0,
      h1s,
      h1Count: h1s.length,
      lang: document.documentElement.getAttribute("lang"),
      canonical,
      robotsMeta,
      og,
      twitter,
      jsonLd,
      icons,
      overflow,
      overflowOffenders,
      interactiveCount: interactive.length,
      smallTargets,
      overlapTargets,
      anchors,
      forms,
      images,
      imageResources,
      priceNumbers: priceNumbers.slice(0, 60),
      priceMissingTabular,
      textWrap,
      fixedSticky,
      viewportMeta,
      disabledControls,
      soonControls,
      bodyTextSample: bodyText.slice(0, 5000),
      bodyTextLength: bodyText.length,
      lowerText,
      cls: typeof window.__auditCls === "number" ? window.__auditCls : null,
    };
  }).catch((error) => ({ evaluateError: error instanceof Error ? error.message : String(error) }));

  const rawText = data.lowerText || "";
  const textMatches = [];
  for (const [name, pattern] of [...PLACEHOLDER_PATTERNS, ...CLAIM_PATTERNS]) {
    const match = rawText.match(pattern);
    if (match) {
      const index = Math.max(0, rawText.indexOf(match[0]) - 70);
      textMatches.push({
        pattern: name,
        excerpt: text(rawText.slice(index, index + 220)),
      });
    }
  }

  const finalUrl = page.url();
  const headers = response?.headers?.() ?? {};
  const images = data.images ?? [];
  const imageResources = data.imageResources ?? [];
  return {
    kind,
    route,
    width,
    status: response?.status() ?? null,
    finalUrl,
    redirected: finalUrl !== `${BASE_URL}${route}`,
    navigationError,
    headers: {
      "content-type": headers["content-type"] ?? null,
      "x-robots-tag": headers["x-robots-tag"] ?? null,
      "content-security-policy": headers["content-security-policy"] ?? null,
      "strict-transport-security": headers["strict-transport-security"] ?? null,
      "x-content-type-options": headers["x-content-type-options"] ?? null,
      "x-frame-options": headers["x-frame-options"] ?? null,
      "referrer-policy": headers["referrer-policy"] ?? null,
      "permissions-policy": headers["permissions-policy"] ?? null,
    },
    derived: {
      brokenImages: images.filter((image) => image.complete && image.naturalWidth === 0).slice(0, 30),
      missingAlt: images.filter((image) => image.alt === null).slice(0, 30),
      largeServedImages: imageResources.filter((entry) => entry.transferSize > 300 * 1024).slice(0, 30),
      largeServedCount: imageResources.filter((entry) => entry.transferSize > 300 * 1024).length,
    },
    ...data,
    textMatches,
    console: rec.snapshot(),
  };
}

function scanSource() {
  const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".css", ".json", ".md", ".txt"]);
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".env") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.has(path.extname(entry.name).toLowerCase())) files.push(full);
    }
  };
  walk(SRC_ROOT);
  walk(path.join(WEB_ROOT, "scripts"));
  const matches = [];
  for (const file of files) {
    const relative = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const [name, pattern] of [...PLACEHOLDER_PATTERNS, ...CLAIM_PATTERNS]) {
        if (pattern.test(line)) {
          matches.push({
            pattern: name,
            file: relative,
            line: index + 1,
            excerpt: text(line, 240),
          });
        }
      }
    }
  }
  return matches;
}

function scanCss() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) files.push(full);
    }
  };
  walk(SRC_ROOT);
  const summary = {
    files: files.map((file) => path.relative(REPO_ROOT, file).replace(/\\/g, "/")),
    keyframes: [],
    prefersReducedMotion: [],
    safeAreaInsets: [],
    cornerShape: [],
    tabularNumeric: [],
    textWrap: [],
    transitionCount: 0,
    animationCount: 0,
  };
  for (const file of files) {
    const relative = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/@keyframes\s+([\w-]+)/.test(line)) summary.keyframes.push({ file: relative, line: index + 1, name: line.match(/@keyframes\s+([\w-]+)/)[1] });
      if (/prefers-reduced-motion/.test(line)) summary.prefersReducedMotion.push({ file: relative, line: index + 1 });
      if (/env\(safe-area-inset/.test(line)) summary.safeAreaInsets.push({ file: relative, line: index + 1, text: text(line, 160) });
      if (/corner-shape/.test(line)) summary.cornerShape.push({ file: relative, line: index + 1, text: text(line, 160) });
      if (/font-variant-numeric|font-feature-settings/.test(line)) summary.tabularNumeric.push({ file: relative, line: index + 1, text: text(line, 160) });
      if (/text-wrap/.test(line)) summary.textWrap.push({ file: relative, line: index + 1, text: text(line, 160) });
      if (/(^|[;{\s])transition\s*:/.test(line)) summary.transitionCount += 1;
      if (/(^|[;{\s])animation\s*:/.test(line)) summary.animationCount += 1;
    }
  }
  return summary;
}

function listPublicFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const stat = statSync(full);
        files.push({ path: `/${path.relative(PUBLIC_ROOT, full).replace(/\\/g, "/")}`, bytes: stat.size });
      }
    }
  };
  if (existsSync(PUBLIC_ROOT)) walk(PUBLIC_ROOT);
  return files.sort((a, b) => b.bytes - a.bytes);
}

function detectDuplicates(routeAudits) {
  const byPath = new Map();
  for (const audit of routeAudits) {
    if (audit.width !== 1280 || audit.status !== 200) continue;
    const sample = (audit.bodyTextSample || "").replace(/\s+/g, " ").trim();
    if (sample.length < 40) continue;
    const hash = createHash("sha256").update(sample).digest("hex");
    const list = byPath.get(hash) ?? [];
    list.push(audit.route);
    byPath.set(hash, list);
  }
  return Array.from(byPath.values()).filter((routes) => routes.length > 1);
}

async function auditMenuHover(context) {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(500);
    const trigger = page.locator('header nav button[aria-haspopup="true"]:visible, header .zf-nav__links button[aria-haspopup="true"]:visible').first();
    if ((await trigger.count()) === 0) {
      return { supported: false, reason: "no mega-menu trigger rendered" };
    }
    const box = await trigger.boundingBox();
    if (!box) return { supported: false, reason: "trigger has no box" };
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
    await page.waitForTimeout(400);
    const opened = await page.locator(".zf-mega.is-open").count();
    if (opened === 0) return { supported: true, opened: false, reason: "panel did not open on hover" };
    const panel = page.locator(".zf-mega.is-open").first();
    const panelBox = await panel.boundingBox();
    if (!panelBox) return { supported: true, opened: true, reason: "panel has no box" };
    const before = await page.locator(".zf-mega.is-open").first().getAttribute("id");
    const steps = 14;
    for (let index = 1; index <= steps; index += 1) {
      const x = box.x + box.width / 2 + ((panelBox.x + 40 - (box.x + box.width / 2)) * index) / steps;
      const y = box.y + box.height / 2 + ((panelBox.y + panelBox.height / 2 - (box.y + box.height / 2)) * index) / steps;
      await page.mouse.move(x, y);
      await page.waitForTimeout(35);
    }
    await page.waitForTimeout(400);
    const afterOpen = await page.locator(".zf-mega.is-open").count();
    const after = afterOpen > 0 ? await page.locator(".zf-mega.is-open").first().getAttribute("id") : null;
    const expanded = await trigger.getAttribute("aria-expanded");
    return {
      supported: true,
      opened: true,
      before,
      after,
      afterOpen,
      expanded,
      closedDuringMove: afterOpen === 0,
      switchedDuringMove: afterOpen > 0 && after !== before,
    };
  } catch (error) {
    return { supported: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function auditSearchPanel(context) {
  const page = await context.newPage();
  const rec = recorder(page);
  const results = [];
  try {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      rec.reset();
      await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(350);
      await page.locator('button[aria-label="Search"]').first().click({ timeout: 5000 });
      const input = page.locator("#zf-search-panel input[type=search]").first();
      await input.waitFor({ timeout: 8000 });
      const attributes = await input.evaluate((element) => ({
        type: element.getAttribute("type"),
        name: element.getAttribute("name"),
        autocomplete: element.getAttribute("autocomplete"),
        inputmode: element.getAttribute("inputmode"),
        placeholder: element.getAttribute("placeholder"),
        ariaLabel: element.getAttribute("aria-label"),
        role: element.getAttribute("role"),
      }));
      await input.fill("sofa");
      await page.waitForTimeout(1000);
      const state = await page.evaluate(() => {
        const viewportWidth = window.innerWidth;
        const panel = document.querySelector("#zf-search-panel");
        const list = document.querySelector("#zf-search-panel [role=listbox]");
        const options = Array.from(
          document.querySelectorAll("#zf-search-panel [role=option]"),
        );
        const rect = panel?.getBoundingClientRect();
        return {
          open: Boolean(panel),
          panel: rect
            ? {
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
                inside: rect.left >= -1 && rect.right <= viewportWidth + 1,
              }
            : null,
          listboxPresent: Boolean(list),
          optionCount: options.length,
          optionText: options
            .slice(0, 8)
            .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
            .filter(Boolean),
          bodyOverflow: getComputedStyle(document.body).overflow,
        };
      });
      results.push({ width, attributes, ...state, console: rec.snapshot() });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
    return results;
  } catch (error) {
    return [{ error: error instanceof Error ? error.message : String(error) }];
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function auditMobileNav(context) {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(350);
    const trigger = page.locator('button[aria-label="Open menu"]').first();
    if ((await trigger.count()) === 0) {
      return { opened: false, reason: "open-menu button not rendered" };
    }
    await trigger.click({ timeout: 5000 });
    await page.waitForSelector(".zf-drawer.is-open", { timeout: 8000 });
    await page.waitForTimeout(450);
    const state = await page.evaluate(() => {
      const panel = document.querySelector(".zf-drawer__panel");
      const close = document.querySelector(
        '.zf-drawer__panel button[aria-label="Close menu"]',
      );
      const rows = Array.from(document.querySelectorAll(".zf-drawer__row"));
      const rect = panel?.getBoundingClientRect();
      const closeRect = close?.getBoundingClientRect();
      return {
        opened: Boolean(panel),
        panel: rect
          ? {
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
              insideViewport:
                rect.left >= -1 && rect.right <= window.innerWidth + 1,
            }
          : null,
        bodyOverflow: getComputedStyle(document.body).overflow,
        ariaModal: panel?.getAttribute("aria-modal"),
        closeTarget: closeRect
          ? {
              width: Math.round(closeRect.width),
              height: Math.round(closeRect.height),
            }
          : null,
        rowCount: rows.length,
        rowsBelow44: rows
          .map((row) => {
            const box = row.getBoundingClientRect();
            return {
              text: (row.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
              width: Math.round(box.width),
              height: Math.round(box.height),
            };
          })
          .filter((row) => row.width < 44 || row.height < 44)
          .slice(0, 20),
      };
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    return state;
  } catch (error) {
    return { opened: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function responseHeaders(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "zayn-launch-audit/1.0" },
    });
    const interesting = [
      "content-type",
      "content-security-policy",
      "strict-transport-security",
      "x-content-type-options",
      "x-frame-options",
      "referrer-policy",
      "permissions-policy",
      "x-robots-tag",
      "cross-origin-resource-policy",
      "cache-control",
      "set-cookie",
    ];
    return {
      status: response.status,
      location: response.headers.get("location"),
      headers: Object.fromEntries(
        interesting.map((name) => [name, response.headers.get(name)]),
      ),
    };
  } catch (error) {
    return { status: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  if (!TOKEN) {
    try {
      TOKEN = mintDevAdminToken();
    } catch (error) {
      console.error(
        error instanceof Error
          ? error.message
          : "Admin session token is unavailable.",
      );
      process.exit(2);
    }
  }
  if (!TOKEN) {
    console.error("Admin session token is unavailable.");
    process.exit(2);
  }
  const server = await fetchText(BASE_URL, 5000);
  if (!server.ok && server.status === null) {
    console.error(`Dev server is not reachable at ${BASE_URL}.`);
    process.exit(2);
  }

  const discovery = await discoverDataRoutes();
  progress(`discovered ${discovery.routes.size} routes`);
  const sourceMatches = scanSource();
  const css = scanCss();
  const publicFiles = listPublicFiles();

  const browser = await chromium.launch();
  const publicContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await publicContext.addInitScript(() => {
    window.__auditCls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__auditCls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Layout shift observer not supported.
    }
  });
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await adminContext.addInitScript(() => {
    window.__auditCls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__auditCls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Layout shift observer not supported.
    }
  });
  await adminContext.addCookies([{
    name: "zf_admin_session",
    value: TOKEN,
    url: BASE_URL,
    httpOnly: true,
    sameSite: "Lax",
    secure: BASE_URL.startsWith("https://"),
  }]);

  const publicPage = await publicContext.newPage();
  const publicRecorder = recorder(publicPage);
  const adminPage = await adminContext.newPage();
  const adminRecorder = recorder(adminPage);

  const routeSet = new Set(discovery.routes);
  try {
    await publicPage.setViewportSize({ width: 1280, height: 900 });
    await publicPage.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await publicPage.waitForTimeout(300);
    for (const href of await collectAnchors(publicPage)) {
      const path = internalHref(href.href, BASE_URL);
      if (path) routeSet.add(path);
    }
    await publicPage.setViewportSize({ width: 390, height: 844 });
    await publicPage.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await publicPage.waitForTimeout(300);
    const menu = publicPage.locator('button[aria-label="Open menu"]').first();
    if ((await menu.count()) > 0) {
      await menu.click({ timeout: 5000 }).catch(() => undefined);
      await publicPage.waitForTimeout(250);
      for (const href of await publicPage.evaluate(() => Array.from(document.querySelectorAll(".zf-drawer a[href], .zf-drawer__panel a[href]")).map((anchor) => anchor.getAttribute("href") || ""))) {
        const path = internalHref(href, BASE_URL);
        if (path) routeSet.add(path);
      }
      await publicPage.locator('.zf-drawer__panel button[aria-label="Close menu"]').first().click({ timeout: 3000 }).catch(() => undefined);
    }
  } catch {
    // Discovery failures are recorded by the normal route audit.
  }

  const routeAudits = [];
  let routeIndex = 0;
  for (const route of Array.from(routeSet).sort()) {
    routeIndex += 1;
    progress(`storefront ${routeIndex}/${routeSet.size} ${route}`);
    for (const width of WIDTHS) {
      routeAudits.push(await auditPage({ context: publicContext, page: publicPage, recorder: publicRecorder, route, width, kind: "storefront" }));
    }
  }

  const linkMap = new Map();
  for (const audit of routeAudits) {
    for (const anchor of audit.anchors || []) {
      const href = anchor.href || "";
      const key = href;
      if (!linkMap.has(key)) {
        linkMap.set(key, { href, type: "empty", internal: null, text: anchor.text, visible: anchor.visible });
      }
    }
  }
  for (const [key, link] of linkMap) {
    const trimmed = key.trim();
    if (!trimmed) link.type = "empty";
    else if (trimmed === "#") link.type = "anchor-empty";
    else if (trimmed.startsWith("#")) link.type = "fragment";
    else if (/^mailto:/i.test(trimmed)) link.type = "mailto";
    else if (/^tel:/i.test(trimmed)) link.type = "tel";
    else if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      link.type = url.origin === new URL(BASE_URL).origin ? "internal" : "external";
    } else {
      const path = internalHref(trimmed, BASE_URL);
      link.type = path ? "internal" : "invalid";
      link.internal = path;
    }
  }
  for (const link of linkMap.values()) {
    progress(`link ${link.type} ${link.href}`);
    if (link.type === "internal") {
      const result = await linkStatus(new URL(link.href, BASE_URL).toString(), BASE_URL);
      link.status = result.status;
      link.chain = result.chain;
      link.error = result.error ?? null;
    } else if (link.type === "external") {
      link.status = await externalStatus(link.href).then((result) => result.status).catch(() => null);
    }
  }

  const adminAudits = [];
  progress("admin pages");
  const loginPage = await publicContext.newPage();
  const loginRecorder = recorder(loginPage);
  for (const width of ADMIN_WIDTHS) {
    adminAudits.push(await auditPage({ context: publicContext, page: loginPage, recorder: loginRecorder, route: "/admin/login", width, kind: "admin-login" }));
  }
  await loginPage.close().catch(() => undefined);
  let pricePanel = null;
  for (const route of ADMIN_ROUTES.filter((item) => item !== "/admin/login")) {
    for (const width of ADMIN_WIDTHS) {
      adminAudits.push(await auditPage({ context: adminContext, page: adminPage, recorder: adminRecorder, route, width, kind: "admin" }));
    }
    if (route === "/admin/products") {
      try {
        await adminPage.setViewportSize({ width: 1280, height: 900 });
        await adminPage.goto(`${BASE_URL}/admin/products`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await adminPage.waitForTimeout(500);
        const button = adminPage.getByRole("button", { name: "Change prices" }).first();
        if ((await button.count()) > 0) {
          await button.click({ timeout: 5000 });
          await adminPage.getByRole("dialog").waitFor({ timeout: 10000 });
          pricePanel = await adminPage.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return {
              opened: Boolean(dialog),
              heading: dialog?.querySelector("h2,h3")?.textContent?.trim() ?? null,
              text: (dialog?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 800),
              disabledButtons: Array.from(dialog?.querySelectorAll("button:disabled") ?? []).map((node) => (node.textContent || "").trim()).slice(0, 20),
            };
          });
          await adminPage.getByRole("button", { name: "Close" }).first().click({ timeout: 3000 }).catch(() => undefined);
        }
      } catch (error) {
        pricePanel = { opened: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  const menuHover = await auditMenuHover(publicContext);
  progress("menu hover done");
  const searchPanel = await auditSearchPanel(publicContext);
  progress("search panel done");
  const mobileNav = await auditMobileNav(publicContext);
  progress("mobile nav done");
  const faviconStatus = await linkStatus(`${BASE_URL}/favicon.ico`, BASE_URL);
  const appleIconStatus = await linkStatus(`${BASE_URL}/apple-touch-icon.png`, BASE_URL);
  const robots = await fetchText(`${BASE_URL}/robots.txt`);
  const sitemap = await fetchText(`${BASE_URL}/sitemap.xml`);
  const securityHeaders = {
    storefront: await responseHeaders(`${BASE_URL}/`),
    adminLogin: await responseHeaders(`${BASE_URL}/admin/login`),
    media404: await responseHeaders(`${BASE_URL}/media/does-not-exist.webp`),
    robots: await responseHeaders(`${BASE_URL}/robots.txt`),
    applePayAssociation: await responseHeaders(
      `${BASE_URL}/.well-known/apple-developer-merchantid-domain-association`,
    ),
  };
  const adminCookieFlags = (await adminContext.cookies(BASE_URL)).map(
    (cookie) => ({
      name: cookie.name,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      path: cookie.path,
    }),
  );

  const result = {
    label: LABEL,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    apiUrl: API_URL,
    widths: WIDTHS,
    adminWidths: ADMIN_WIDTHS,
    discovery: {
      routeCount: routeSet.size,
      routes: Array.from(routeSet).sort(),
      productSlugs: discovery.productSlugs,
      categoriesOk: discovery.categoriesOk,
      productsOk: discovery.productsOk,
      sitemapStatus: discovery.sitemapStatus,
    },
    routeAudits,
    linkMap: Array.from(linkMap.values()),
    duplicateContent: detectDuplicates(routeAudits),
    adminAudits,
    pricePanel,
    menuHover,
    searchPanel,
    mobileNav,
    securityHeaders,
    adminCookieFlags,
    favicon: faviconStatus,
    appleTouchIcon: appleIconStatus,
    robots: { status: robots.status, body: robots.body.slice(0, 2000) },
    sitemap: { status: sitemap.status, bodyLength: sitemap.body.length, sample: sitemap.body.slice(0, 2000) },
    sourceMatches,
    css,
    publicFiles,
    counts: {
      routesAudited: routeSet.size,
      routePageChecks: routeAudits.length,
      adminPageChecks: adminAudits.length,
      pagesWithOverflow: new Set(routeAudits.filter((audit) => audit.overflow === false).map((audit) => audit.route)).size,
      pagesWithSmallTargets: new Set(routeAudits.filter((audit) => (audit.smallTargets ?? []).length > 0).map((audit) => audit.route)).size,
      brokenInternalLinks: Array.from(linkMap.values()).filter((link) => link.type === "internal" && (link.status === null || link.status >= 400)).length,
      emptyHrefLinks: Array.from(linkMap.values()).filter((link) => link.type === "empty").length,
      hashOnlyLinks: Array.from(linkMap.values()).filter((link) => link.type === "anchor-empty").length,
      mailtoLinks: Array.from(linkMap.values()).filter((link) => link.type === "mailto").length,
      telLinks: Array.from(linkMap.values()).filter((link) => link.type === "tel").length,
      pagesMissingTitle: new Set(routeAudits.filter((audit) => !audit.title).map((audit) => audit.route)).size,
      pagesWithLongTitle: new Set(routeAudits.filter((audit) => (audit.titleLength ?? 0) > 60).map((audit) => audit.route)).size,
      pagesMissingDescription: new Set(routeAudits.filter((audit) => !audit.description).map((audit) => audit.route)).size,
      pagesWithDuplicateDescription: (() => {
        const counts = new Map();
        for (const audit of routeAudits.filter((item) => item.width === 1280 && item.description)) {
          counts.set(audit.description, (counts.get(audit.description) ?? 0) + 1);
        }
        return Array.from(counts.values()).filter((count) => count > 1).length;
      })(),
      pagesWithoutExactlyOneH1: new Set(routeAudits.filter((audit) => audit.h1Count !== 1).map((audit) => audit.route)).size,
      pagesOverflowing: new Set(routeAudits.filter((audit) => audit.overflow === false).map((audit) => audit.route)).size,
      pagesWithBrokenImages: new Set(routeAudits.filter((audit) => (audit.derived?.brokenImages ?? []).length > 0).map((audit) => audit.route)).size,
      pagesWithMissingAlt: new Set(routeAudits.filter((audit) => (audit.derived?.missingAlt ?? []).length > 0).map((audit) => audit.route)).size,
      pagesWithLargeServedImages: new Set(routeAudits.filter((audit) => (audit.derived?.largeServedCount ?? 0) > 0).map((audit) => audit.route)).size,
      adminPagesMissingNoindex: new Set(adminAudits.filter((audit) => !/noindex/i.test(audit.robotsMeta ?? "") && !/noindex/i.test(audit.headers?.["x-robots-tag"] ?? "")).map((audit) => audit.route)).size,
    },
  };

  mkdirSync(path.dirname(RAW_PATH), { recursive: true });
  let existing = {};
  if (existsSync(RAW_PATH)) {
    try {
      existing = JSON.parse(readFileSync(RAW_PATH, "utf8"));
    } catch {
      existing = {};
    }
  }
  existing[LABEL] = result;
  existing.updatedAt = new Date().toISOString();
  writeFileSync(RAW_PATH, JSON.stringify(existing, null, 2));
  console.log(`Audit written: ${RAW_PATH} (${LABEL}; ${routeAudits.length} storefront checks, ${adminAudits.length} admin checks)`);

  await publicPage.close().catch(() => undefined);
  await adminPage.close().catch(() => undefined);
  await publicContext.close().catch(() => undefined);
  await adminContext.close().catch(() => undefined);
  await browser.close();
}

run().catch((error) => {
  console.error("Audit failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
