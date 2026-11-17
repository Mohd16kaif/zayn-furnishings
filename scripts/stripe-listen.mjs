import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  extractWebhookSecrets,
  maskSecretEnd,
  parseEnv,
  redactSecrets,
  secretsMatch,
  updateEnvFileValue,
} from "./stripe-listen-lib.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ENV_PATH = path.join(REPO_ROOT, "apps", "api", ".env");
const EVENTS = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "charge.refunded",
];
const FORWARD_TO = "localhost:4000/webhooks/stripe";

function printUsage() {
  console.log(`Usage: pnpm stripe:listen [-- --sync]

Starts a Stripe CLI listener for local webhook development.

Options:
  --sync   If the listener's signing secret differs from apps/api/.env,
           update STRIPE_WEBHOOK_SECRET there and leave all other lines alone.
  --help   Show this help. Does not read .env or contact Stripe.

Behavior:
  - Reads apps/api/.env in memory and refuses to run unless STRIPE_SECRET_KEY
    starts with sk_test_.
  - Forwards ${EVENTS.join(", ")}
    to ${FORWARD_TO}.
  - Redacts webhook and API key values from CLI output.
  - On a signing secret mismatch, prints the last 4 characters only.
`);
}

function refuse(message) {
  console.error(message);
  process.exitCode = 1;
}

function checkStripeCli() {
  const result = spawnSync("stripe", ["--version"], {
    stdio: "ignore",
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    return false;
  }

  return true;
}

function printMismatch(envSecret, listenerSecret) {
  const envLabel = envSecret
    ? `.env ends ...${maskSecretEnd(envSecret)}`
    : ".env has no STRIPE_WEBHOOK_SECRET";
  const listenerLabel = `this listener uses ...${maskSecretEnd(listenerSecret)}`;
  const bar = "=".repeat(72);

  console.error(`
${bar}
WEBHOOK SECRET MISMATCH
${envLabel} but ${listenerLabel}: webhooks will fail with 400.
Run: pnpm stripe:listen -- --sync
${bar}
`);
}

function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const unknown = args.filter(
    (arg) => arg !== "--sync" && arg !== "--help" && arg !== "-h",
  );

  if (unknown.length > 0) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const sync = args.includes("--sync");

  let envContent;

  try {
    // Read in memory only. Never print the contents.
    envContent = parseEnv(readFileSync(ENV_PATH, "utf8"));
  } catch {
    refuse(
      "Refusing to run: could not read apps/api/.env. Create the file and set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.",
    );
    return;
  }

  const secretKey = envContent.STRIPE_SECRET_KEY?.trim() ?? "";

  if (!secretKey.startsWith("sk_test_")) {
    refuse(
      "Refusing to run: STRIPE_SECRET_KEY in apps/api/.env must be a Stripe test key starting with sk_test_.",
    );
    return;
  }

  let webhookSecret = envContent.STRIPE_WEBHOOK_SECRET?.trim() ?? "";

  if (!checkStripeCli()) {
    refuse(`The Stripe CLI was not found on PATH.

Open a NEW PowerShell window so the updated PATH is picked up, or install it with:
  winget install Stripe.StripeCLI
`);
    return;
  }

  const child = spawn(
    "stripe",
    [
      "listen",
      "--api-key",
      secretKey,
      "--events",
      EVENTS.join(","),
      "--forward-to",
      FORWARD_TO,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let interrupted = false;
  let syncing = false;
  const seenSecrets = new Set();

  const finish = (code) => {
    process.exitCode = interrupted ? 0 : (code ?? 0);
  };

  const handleSecret = (listenerSecret) => {
    if (seenSecrets.has(listenerSecret)) {
      return;
    }

    seenSecrets.add(listenerSecret);

    if (secretsMatch(webhookSecret, listenerSecret)) {
      console.log(
        `OK: webhook secret matches apps/api/.env (ends ...${maskSecretEnd(
          webhookSecret,
        )})`,
      );
      return;
    }

    printMismatch(webhookSecret, listenerSecret);

    if (!sync || syncing) {
      return;
    }

    syncing = true;

    void updateEnvFileValue(
      ENV_PATH,
      "STRIPE_WEBHOOK_SECRET",
      listenerSecret,
    )
      .then(() => {
        webhookSecret = listenerSecret;
        console.log(
          "Updated .env. Restart pnpm dev now: the API reads it only at startup.",
        );
      })
      .catch(() => {
        console.error(
          "Could not update apps/api/.env. Check permissions and try again.",
        );
      })
      .finally(() => {
        syncing = false;
      });
  };

  const handleLine = (line, stream) => {
    for (const secret of extractWebhookSecrets(line)) {
      handleSecret(secret);
    }

    stream.write(redactSecrets(line));
  };

  const forward = (input, output) => {
    let buffer = "";

    input.setEncoding("utf8");
    input.on("data", (chunk) => {
      buffer += chunk;

      let index = buffer.indexOf("\n");

      while (index !== -1) {
        const line = buffer.slice(0, index + 1);
        buffer = buffer.slice(index + 1);
        handleLine(line, output);
        index = buffer.indexOf("\n");
      }
    });
    input.on("end", () => {
      if (buffer) {
        handleLine(buffer, output);
        buffer = "";
      }
    });
  };

  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  child.on("error", () => {
    console.error(
      "Could not start the Stripe CLI. Check the installation and try again.",
    );
    process.exitCode = 1;
  });

  child.on("exit", (code) => {
    finish(code);
  });

  const stop = () => {
    interrupted = true;

    try {
      child.kill("SIGINT");
    } catch {
      // The child may have already stopped.
    }

    const force = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore a second stop attempt.
      }
    }, 5_000);

    force.unref();
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main();
