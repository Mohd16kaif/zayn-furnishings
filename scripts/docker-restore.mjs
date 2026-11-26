import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { ENV_PATH } from "./compose-init-env.mjs";
import { readComposeEnvFile } from "./compose-env.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const COMPOSE_FILE = "docker-compose.stack.yml";
const PROJECT = "zayn";
const SERVICE = "backup";
const DB_IMAGE = "postgres:16";

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: options.inherit
      ? "inherit"
      : [options.stdin ? "inherit" : "ignore", "pipe", "pipe"],
    timeout: options.timeout ?? 120_000,
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function compose(args, options = {}) {
  return docker(
    [
      "compose",
      "-p",
      PROJECT,
      "-f",
      COMPOSE_FILE,
      "--env-file",
      ENV_PATH,
      ...args,
    ],
    options,
  );
}

function envValue(values, key) {
  return (process.env[key] ?? values.get(key) ?? "").trim();
}

function parseArgs(argv) {
  const options = {
    listOnly: false,
    intoLive: false,
    run: null,
    snapshot: null,
    dbSnapshot: null,
    mediaSnapshot: null,
    mediaTarget: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--list") {
      options.listOnly = true;
    } else if (arg === "--into-live") {
      options.intoLive = true;
    } else if (arg === "--run") {
      options.run = argv[++index] ?? null;
    } else if (arg === "--snapshot") {
      options.snapshot = argv[++index] ?? null;
    } else if (arg === "--db-snapshot") {
      options.dbSnapshot = argv[++index] ?? null;
    } else if (arg === "--media-snapshot") {
      options.mediaSnapshot = argv[++index] ?? null;
    } else if (arg === "--media-target") {
      options.mediaTarget = argv[++index] ?? null;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  console.log(`Usage: pnpm docker:restore -- [options]

  --list                   List backup pairs and exit
  --run <run-tag>          Restore the db/media pair with this tag
  --snapshot <id>          Use the same snapshot id for db and media
  --db-snapshot <id>       Override the database snapshot
  --media-snapshot <id>    Override the media snapshot
  --media-target <name>    Empty Docker volume name for restored media
  --into-live              Restore into the live stack (also type RESTORE-LIVE)

Without --into-live this creates a fresh throwaway PostgreSQL container and a
fresh media Docker volume. The live database and media volume are never touched.`);
}

function requireEnvFile() {
  if (!existsSync(ENV_PATH)) {
    throw new Error(
      ".env.compose is missing. Run `pnpm docker:stack:init` first.",
    );
  }
}

function requireBackupEnv(values) {
  if (!envValue(values, "RESTIC_PASSWORD")) {
    throw new Error(
      "RESTIC_PASSWORD is missing in .env.compose. Add it; the value is never printed.",
    );
  }

  if (!envValue(values, "RESTIC_REPOSITORY")) {
    throw new Error(
      "RESTIC_REPOSITORY is missing in .env.compose. Add /repo or a real remote repository.",
    );
  }
}

function ensureBackupImage() {
  const inspected = docker(["image", "inspect", "zayn-backup:stack"]);

  if (inspected.status !== 0) {
    console.log("Building the backup image...");
    const built = compose(["--profile", "backup", "build", "backup"], {
      inherit: true,
      timeout: 30 * 60 * 1000,
    });

    if (built.status !== 0) {
      throw new Error("Could not build the backup image.");
    }
  }
}

function stackNetwork() {
  const result = docker([
    "network",
    "ls",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${PROJECT}`,
    "--filter",
    "label=com.docker.compose.network=stack",
  ]);
  const id = result.stdout.trim().split(/\r?\n/).filter(Boolean)[0];

  if (!id) {
    throw new Error(
      "The zayn stack network is missing. Start the stack once with `pnpm docker:stack:up` so the network exists.",
    );
  }

  return id;
}

function composeVolumeName(key) {
  const result = docker([
    "volume",
    "ls",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${PROJECT}`,
    "--filter",
    `label=com.docker.compose.volume=${key}`,
  ]);
  const name = result.stdout.trim().split(/\r?\n/).filter(Boolean)[0];

  if (!name) {
    throw new Error(
      `Could not find the ${key} Docker volume for the ${PROJECT} project.`,
    );
  }

  return name;
}

function serviceRunning(service) {
  const id = compose(["ps", "-q", service]).stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)[0];

  if (!id) {
    return false;
  }

  return (
    docker(["inspect", "--format", "{{.State.Running}}", id]).stdout.trim() ===
    "true"
  );
}

function listSnapshots(values) {
  ensureBackupImage();
  const result = compose(
    [
      "--profile",
      "backup",
      "run",
      "--rm",
      "--no-deps",
      SERVICE,
      "snapshots-json",
    ],
    { timeout: 120_000 },
  );

  if (result.status !== 0) {
    throw new Error(
      "Could not list restic snapshots. Check RESTIC_REPOSITORY and RESTIC_PASSWORD.",
    );
  }

  const text = `${result.stdout ?? ""}`.trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("The restic snapshot list was not valid JSON.");
  }

  return JSON.parse(text.slice(start, end + 1));
}

function snapshotHasTag(snapshot, tag) {
  return Array.isArray(snapshot.tags) && snapshot.tags.includes(tag);
}

function pairSnapshots(snapshots) {
  const pairs = new Map();

  for (const snapshot of snapshots) {
    const tags = Array.isArray(snapshot.tags) ? snapshot.tags : [];
    const runTag = tags.find((tag) => tag.startsWith("run-"));

    if (!runTag) {
      continue;
    }

    const pair = pairs.get(runTag) ?? { runTag };
    const db = tags.includes("db");
    const media = tags.includes("media");

    if (db && (!pair.db || snapshot.time > pair.db.time)) {
      pair.db = snapshot;
    }

    if (media && (!pair.media || snapshot.time > pair.media.time)) {
      pair.media = snapshot;
    }

    pairs.set(runTag, pair);
  }

  return [...pairs.values()]
    .filter((pair) => pair.db && pair.media)
    .sort((left, right) => right.db.time.localeCompare(left.db.time));
}

function findSnapshot(snapshots, value, tag) {
  return snapshots.find(
    (snapshot) =>
      (snapshot.id === value || snapshot.short_id === value) &&
      snapshotHasTag(snapshot, tag),
  );
}

function resolvePair(snapshots, options) {
  const pairs = pairSnapshots(snapshots);

  if (options.snapshot) {
    const known = snapshots.find(
      (snapshot) =>
        snapshot.id === options.snapshot ||
        snapshot.short_id === options.snapshot,
    );

    if (!known) {
      throw new Error("The requested snapshot was not found.");
    }

    const runTag = known.tags.find((tag) => tag.startsWith("run-"));

    if (!runTag) {
      throw new Error(
        "The requested snapshot has no shared run tag; pass --db-snapshot and --media-snapshot explicitly.",
      );
    }

    const pair = pairs.find((entry) => entry.runTag === runTag);

    if (!pair) {
      throw new Error(
        `No db/media pair exists for run tag ${runTag}. Pass both snapshots explicitly.`,
      );
    }

    return pair;
  }

  if (options.dbSnapshot && options.mediaSnapshot) {
    const db = findSnapshot(snapshots, options.dbSnapshot, "db");
    const media = findSnapshot(snapshots, options.mediaSnapshot, "media");

    if (!db || !media) {
      throw new Error("The requested db or media snapshot was not found.");
    }

    const runTag =
      db.tags.find((tag) => tag.startsWith("run-")) ?? "explicit";

    return { runTag, db, media };
  }

  if (options.dbSnapshot || options.mediaSnapshot) {
    const known = options.dbSnapshot
      ? findSnapshot(snapshots, options.dbSnapshot, "db")
      : findSnapshot(snapshots, options.mediaSnapshot, "media");

    if (!known) {
      throw new Error("The requested snapshot was not found.");
    }

    const runTag = known.tags.find((tag) => tag.startsWith("run-"));

    if (!runTag) {
      throw new Error("The requested snapshot has no shared run tag.");
    }

    const pair = pairs.find((entry) => entry.runTag === runTag);

    if (!pair) {
      throw new Error(
        `No db/media pair exists for run tag ${runTag}. Pass both snapshots explicitly.`,
      );
    }

    return {
      runTag,
      db: options.dbSnapshot ? known : pair.db,
      media: options.mediaSnapshot ? known : pair.media,
    };
  }

  if (options.run) {
    const pair = pairs.find((entry) => entry.runTag === options.run);

    if (!pair) {
      throw new Error(
        `No db/media pair exists for run tag ${options.run}. Available: ${pairs
          .map((entry) => entry.runTag)
          .join(", ")}`,
      );
    }

    return pair;
  }

  if (pairs.length === 0) {
    throw new Error("No restic db/media snapshot pairs were found.");
  }

  return pairs[0];
}

function printPairs(pairs) {
  if (pairs.length === 0) {
    console.log("No db/media backup pairs found.");
    return;
  }

  console.log("Available backup pairs (newest first):");
  console.log("time                  run-tag                 db          media");

  for (const pair of pairs.slice(0, 10)) {
    console.log(
      `${pair.db.time.padEnd(21)} ${pair.runTag.padEnd(23)} ${pair.db.short_id.padEnd(11)} ${pair.media.short_id}`,
    );
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPg(container, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = docker(
      ["exec", container, "pg_isready", "-U", "restore", "-d", "restored"],
      { timeout: 10_000 },
    );

    if (result.status === 0) {
      return;
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

function runComposeRestore(args, label) {
  const result = compose(
    ["--profile", "backup", "run", "--rm", "--no-deps", ...args],
    { inherit: true, timeout: 60 * 60 * 1000 },
  );

  if (result.status !== 0) {
    throw new Error(`${label} failed.`);
  }
}

async function restoreToFreshTarget(pair, options, values) {
  const suffix = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const network = stackNetwork();
  const pgName = `zayn-restore-pg-${suffix}`;
  const pgVolume = `zayn-restore-pgdata-${suffix}`;
  const pgAlias = `restore-pg-${suffix}`;
  const defaultMediaVolume = `zayn-restore-media-${suffix}`;
  const created = [];
  let finished = false;

  let mediaTarget = options.mediaTarget;
  let mediaTargetIsVolume = true;

  if (mediaTarget && (path.isAbsolute(mediaTarget) || mediaTarget.startsWith("."))) {
    const resolved = path.resolve(REPO_ROOT, mediaTarget);

    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new Error(`Media target ${resolved} is not an existing directory.`);
    }

    if (statSync(resolved).isDirectory()) {
      const entries = await import("node:fs/promises").then((fs) =>
        fs.readdir(resolved),
      );

      if (entries.filter((entry) => entry !== "lost+found").length > 0) {
        throw new Error(
          `Media target ${resolved} is not empty. Use an empty directory.`,
        );
      }
    }

    mediaTarget = resolved;
    mediaTargetIsVolume = false;
  }

  if (!mediaTarget) {
    mediaTarget = defaultMediaVolume;
    const createdVolume = docker(["volume", "create", mediaTarget]);

    if (createdVolume.status !== 0) {
      throw new Error("Could not create the fresh media restore volume.");
    }

    created.push({ kind: "volume", name: mediaTarget });
  } else if (mediaTargetIsVolume) {
    const inspected = docker(["volume", "inspect", mediaTarget]);

    if (inspected.status !== 0) {
      const createdVolume = docker(["volume", "create", mediaTarget]);

      if (createdVolume.status !== 0) {
        throw new Error(`Could not create media volume ${mediaTarget}.`);
      }

      created.push({ kind: "volume", name: mediaTarget });
    }
  }

  try {
    const volume = docker(["volume", "create", pgVolume]);

    if (volume.status !== 0) {
      throw new Error("Could not create the throwaway PostgreSQL volume.");
    }

    created.push({ kind: "volume", name: pgVolume });

    const pg = docker([
      "run",
      "-d",
      "--name",
      pgName,
      "--network",
      network,
      "--network-alias",
      pgAlias,
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-e",
      "POSTGRES_USER=restore",
      "-e",
      "POSTGRES_DB=restored",
      "-v",
      `${pgVolume}:/var/lib/postgresql/data`,
      DB_IMAGE,
    ]);

    if (pg.status !== 0) {
      throw new Error("Could not start the throwaway PostgreSQL container.");
    }

    created.push({ kind: "container", name: pgName });
    await waitForPg(pgName, "the throwaway PostgreSQL container");

    runComposeRestore(
      [
        "-e",
        `PGHOST=${pgAlias}`,
        "-e",
        "PGUSER=restore",
        "-e",
        "PGDATABASE=restored",
        "-e",
        "PGPASSWORD=",
        SERVICE,
        "restore-db",
        pair.db.id,
        "restored",
      ],
      "Database restore",
    );

    runComposeRestore(
      [
        "-v",
        `${mediaTarget}:/restore-target`,
        SERVICE,
        "restore-media",
        pair.media.id,
      ],
      "Media restore",
    );

    finished = true;

    console.log("");
    console.log(`Restored run ${pair.runTag}.`);
    console.log(
      `Database: snapshot ${pair.db.short_id} into container ${pgName}, database "restored" (no password, trust auth).`,
    );
    console.log(
      `Media: snapshot ${pair.media.short_id} into ${mediaTargetIsVolume ? "volume" : "directory"} ${mediaTarget}.`,
    );
    console.log(
      "These targets are NOT the live stack. Inspect them with:",
    );
    console.log(
      `  docker exec -it ${pgName} psql -U restore -d restored`,
    );
    console.log("Clean up when finished:");
    console.log(
      `  docker rm -f ${pgName}; docker volume rm ${pgVolume} ${mediaTargetIsVolume ? mediaTarget : ""}`.trim(),
    );
  } finally {
    if (!finished) {
      for (const resource of [...created].reverse()) {
        docker(
          resource.kind === "container"
            ? ["rm", "-f", resource.name]
            : ["volume", "rm", "-f", resource.name],
        );
      }
    }
  }
}

async function restoreIntoLive(pair, values) {
  if (serviceRunning("api") || serviceRunning("web")) {
    throw new Error(
      "Refusing --into-live while the api or web container is running. Stop them first, for example: docker compose -p zayn -f docker-compose.stack.yml --env-file .env.compose stop api web",
    );
  }

  if (!serviceRunning("postgres")) {
    throw new Error(
      "The live postgres container is not running. Start the stack before restoring.",
    );
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let answer = "";

  try {
    answer = await readline.question(
      "Type RESTORE-LIVE to confirm restoring into the live stack: ",
    );
  } finally {
    readline.close();
  }

  if (answer.trim() !== "RESTORE-LIVE") {
    throw new Error("Live restore cancelled.");
  }

  const database = envValue(values, "POSTGRES_DB");

  if (!database) {
    throw new Error("POSTGRES_DB is missing in .env.compose.");
  }

  const mediaVolume = composeVolumeName("media");

  runComposeRestore(
    [SERVICE, "restore-db", pair.db.id, database],
    "Live database restore",
  );

  runComposeRestore(
    [
      "-e",
      "RESTORE_ALLOW_NONEMPTY=1",
      "-v",
      `${mediaVolume}:/restore-target`,
      SERVICE,
      "restore-media",
      pair.media.id,
    ],
    "Live media restore",
  );

  console.log("");
  console.log(`Live restore of run ${pair.runTag} complete.`);
  console.log(
    "The api and web containers are still stopped. Start them, then verify /health and the site:",
  );
  console.log(
    "  docker compose -p zayn -f docker-compose.stack.yml --env-file .env.compose start api web",
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return;
  }

  requireEnvFile();
  const values = readComposeEnvFile(ENV_PATH);
  requireBackupEnv(values);

  const snapshots = listSnapshots(values);
  const pairs = pairSnapshots(snapshots);
  printPairs(pairs);

  if (options.listOnly) {
    return;
  }

  const pair = resolvePair(snapshots, options);

  if (options.intoLive) {
    await restoreIntoLive(pair, values);
  } else {
    await restoreToFreshTarget(pair, options, values);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
