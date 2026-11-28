import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const WEB_ROOT = path.join(REPO_ROOT, "apps", "web");
const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(
  /\/+$/,
  "",
);

function mintDevSession() {
  const args = [
    "--filter",
    "@zayn/api",
    "admin:mint-dev-session",
  ];
  const options = {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
  };
  const attempts = [];

  if (process.env.npm_execpath) {
    attempts.push(() =>
      spawnSync(process.execPath, [process.env.npm_execpath, ...args], options),
    );
  }

  attempts.push(() =>
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", `pnpm.cmd ${args.join(" ")}`],
          options,
        )
      : spawnSync("pnpm", args, options),
  );

  for (const attempt of attempts) {
    const result = attempt();

    if (result.error || result.status !== 0) {
      continue;
    }

    const token = (result.stdout ?? "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();

    if (token) {
      return token;
    }
  }

  return null;
}

function tokenForCheck() {
  return mintDevSession() ?? process.env.ADMIN_SESSION_TOKEN ?? null;
}

const checks = [
  {
    name: "price change",
    cwd: REPO_ROOT,
    script: path.join(REPO_ROOT, "scripts", "check-price-change.mjs"),
    requiresToken: true,
  },
  {
    name: "admin login",
    cwd: WEB_ROOT,
    script: path.join(WEB_ROOT, "scripts", "check-admin-login.mjs"),
    requiresToken: true,
  },
  {
    name: "admin BFF",
    cwd: REPO_ROOT,
    script: path.join(REPO_ROOT, "scripts", "check-admin-bff.mjs"),
    requiresToken: true,
  },
  {
    name: "layout",
    cwd: WEB_ROOT,
    script: path.join(WEB_ROOT, "scripts", "check-layout.mjs"),
    requiresToken: false,
  },
  {
    name: "checkout",
    cwd: WEB_ROOT,
    script: path.join(WEB_ROOT, "scripts", "check-checkout.mjs"),
    requiresToken: false,
  },
  {
    name: "idempotency",
    cwd: REPO_ROOT,
    script: path.join(REPO_ROOT, "scripts", "check-idempotency.mjs"),
    requiresToken: true,
  },
  {
    name: "launch basics",
    cwd: REPO_ROOT,
    script: path.join(REPO_ROOT, "scripts", "check-launch-basics.mjs"),
    requiresToken: true,
  },
];

console.log(`Running server-based checks against ${BASE_URL}`);

const results = [];

for (const check of checks) {
  console.log(`\n== ${check.name} ==`);

  let env = process.env;

  if (check.requiresToken) {
    const token = tokenForCheck();

    if (!token) {
      console.error(
        "Could not mint a dev admin session and ADMIN_SESSION_TOKEN is not set. Set it for this shell only with: $env:ADMIN_SESSION_TOKEN = (pnpm --filter @zayn/api admin:mint-dev-session 2>$null)",
      );
      results.push({ name: check.name, passed: false });
      console.log(`FAIL ${check.name}`);
      continue;
    }

    env = { ...process.env, ADMIN_SESSION_TOKEN: token };
  }

  const result = spawnSync(process.execPath, [check.script], {
    cwd: check.cwd,
    env,
    stdio: "inherit",
  });
  const passed = result.status === 0;

  results.push({ name: check.name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} ${check.name}`);
}

console.log("\nServer-based check results:");
for (const result of results) {
  console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}`);
}

if (results.some((result) => !result.passed)) {
  process.exitCode = 1;
} else {
  console.log("PASS: all server-based checks.");
}
