const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  migrateLegacyHermesHome,
  MIGRATION_MARKER,
} = require("./migrate-home.cjs");

// Build a temp tree shaped like the real legacy ~/.hermes (the entries that
// matter for the manifest), optionally pre-seeding the new home with the files
// a running gateway has already created (sessions.json, cron/, gateway/).
function makeTree(root) {
  fs.mkdirSync(root, { recursive: true });
}

function writeFile(dir, name, body = "") {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body);
}

function exists(p) {
  return fs.existsSync(p);
}

test("coexist merge: moves user data, keeps caches behind, dedups cron/gateway", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-"));
  const home = path.join(tmp, "nexus-agent");
  const legacy = path.join(tmp, "hermes");

  // Legacy ~/.hermes: full inventory.
  makeTree(legacy);
  writeFile(legacy, "config.yaml", "cfg");
  writeFile(legacy, ".env", "SECRET=1");
  writeFile(legacy, "state.db", "db");
  writeFile(legacy, "state.db-shm", "shm");
  writeFile(legacy, "state.db-wal", "wal");
  writeFile(legacy, "kanban.db", "kb");
  writeFile(legacy, "SOUL.md", "soul");
  writeFile(legacy, "auth.json", "{}");
  writeFile(legacy, "channel_directory.json", "{}");
  writeFile(legacy, "models_dev_cache.json", "cache"); // 2.2M cache -> discard
  writeFile(legacy, "ollama_cloud_models_cache.json", "cache"); // discard
  writeFile(legacy, ".clean_shutdown", ""); // transient -> discard
  writeFile(legacy, ".update_check", ""); // discard
  writeFile(legacy, "auth.lock", ""); // discard
  fs.mkdirSync(path.join(legacy, "skills"), { recursive: true });
  writeFile(path.join(legacy, "skills"), "a.md", "skill");
  fs.mkdirSync(path.join(legacy, "memories"), { recursive: true });
  fs.mkdirSync(path.join(legacy, "sessions"), { recursive: true });
  writeFile(path.join(legacy, "sessions"), "dump1.json", "{}");
  fs.mkdirSync(path.join(legacy, "cache"), { recursive: true }); // discard
  fs.mkdirSync(path.join(legacy, "bin"), { recursive: true }); // discard
  fs.mkdirSync(path.join(legacy, "cron"), { recursive: true }); // dedup
  writeFile(path.join(legacy, "cron"), "stale.json", "{}");
  fs.mkdirSync(path.join(legacy, "gateway"), { recursive: true }); // dedup
  writeFile(path.join(legacy, "gateway"), "old-binary", "x");
  writeFile(path.join(legacy, "gateway"), "sidecar-version.json", '{"version":"v0.3.1"}');
  fs.mkdirSync(path.join(legacy, "logs"), { recursive: true });
  writeFile(path.join(legacy, "logs"), "desktop.log", "old desktop log");
  writeFile(path.join(legacy, "logs"), "gateway.log", "legacy gw"); // keep new home's
  writeFile(path.join(legacy, "logs"), "gui.log", "stale"); // drop

  // New home already has live gateway data.
  makeTree(home);
  writeFile(home, "sessions.json", '{"gateway":true}'); // file, must NOT collide with sessions/ dir
  fs.mkdirSync(path.join(home, "cron"), { recursive: true });
  writeFile(path.join(home, "cron"), "jobs.json", '{"live":true}');
  fs.mkdirSync(path.join(home, "gateway"), { recursive: true }); // empty
  fs.mkdirSync(path.join(home, "logs"), { recursive: true });
  writeFile(path.join(home, "logs"), "gateway.log", "live gw log");

  const res = migrateLegacyHermesHome({ home, legacySources: [legacy] });

  // User data moved into the new home.
  assert.equal(exists(path.join(home, "config.yaml")), true);
  assert.equal(exists(path.join(home, ".env")), true);
  assert.equal(exists(path.join(home, "state.db")), true);
  assert.equal(exists(path.join(home, "state.db-shm")), true);
  assert.equal(exists(path.join(home, "state.db-wal")), true);
  assert.equal(exists(path.join(home, "kanban.db")), true);
  assert.equal(exists(path.join(home, "SOUL.md")), true);
  assert.equal(exists(path.join(home, "auth.json")), true);
  assert.equal(exists(path.join(home, "skills", "a.md")), true);
  assert.equal(exists(path.join(home, "memories")), true);
  // sessions/ dir moved alongside the existing sessions.json file (no collision).
  assert.equal(exists(path.join(home, "sessions", "dump1.json")), true);
  assert.equal(exists(path.join(home, "sessions.json")), true);
  assert.equal(
    fs.readFileSync(path.join(home, "sessions.json"), "utf8"),
    '{"gateway":true}',
  );

  // Caches left behind in legacy.
  assert.equal(exists(path.join(legacy, "models_dev_cache.json")), true);
  assert.equal(exists(path.join(legacy, "cache")), true);
  assert.equal(exists(path.join(legacy, "bin")), true);
  assert.equal(exists(path.join(legacy, ".clean_shutdown")), true);

  // Dedup: new home's cron/gateway untouched, legacy's left behind.
  assert.equal(
    fs.readFileSync(path.join(home, "cron", "jobs.json"), "utf8"),
    '{"live":true}',
  );
  assert.equal(exists(path.join(home, "cron", "stale.json")), false);
  assert.equal(exists(path.join(legacy, "cron", "stale.json")), true);
  assert.equal(exists(path.join(home, "gateway", "old-binary")), false);
  assert.equal(exists(path.join(legacy, "gateway", "old-binary")), true);
  // gateway/ is dedup, but the cheap sidecar version stamp is carried over.
  assert.equal(exists(path.join(home, "gateway", "sidecar-version.json")), true);
  assert.equal(
    fs.readFileSync(path.join(home, "gateway", "sidecar-version.json"), "utf8"),
    '{"version":"v0.3.1"}',
  );
  assert.equal(exists(path.join(legacy, "gateway", "sidecar-version.json")), false);

  // Logs merged: desktop.log moved, gateway.log kept (new home's), gui.log dropped.
  assert.equal(
    fs.readFileSync(path.join(home, "logs", "desktop.log"), "utf8"),
    "old desktop log",
  );
  assert.equal(
    fs.readFileSync(path.join(home, "logs", "gateway.log"), "utf8"),
    "live gw log",
  );
  assert.equal(exists(path.join(home, "logs", "gui.log")), false);

  // Marker written, result reports migration.
  assert.equal(exists(path.join(home, MIGRATION_MARKER)), true);
  assert.equal(res.migrated, true);
  assert.ok(res.moved.includes(".env"));
  assert.ok(res.moved.includes("logs/desktop.log"));
  assert.ok(res.moved.includes("gateway/sidecar-version.json"));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("idempotent: second run is a no-op and never rescans", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-"));
  const home = path.join(tmp, "nexus-agent");
  const legacy = path.join(tmp, "hermes");
  makeTree(legacy);
  writeFile(legacy, ".env", "SECRET=1");

  const first = migrateLegacyHermesHome({ home, legacySources: [legacy] });
  assert.equal(first.migrated, true);
  assert.equal(exists(path.join(home, ".env")), true);

  // Re-introduce something in legacy that WOULD move — second run must skip it.
  writeFile(legacy, "config.yaml", "should-not-move");

  const second = migrateLegacyHermesHome({ home, legacySources: [legacy] });
  assert.equal(second.migrated, false);
  assert.deepEqual(second.moved, []);
  assert.equal(exists(path.join(home, "config.yaml")), false);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("fresh machine: no legacy -> writes marker, moves nothing", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-"));
  const home = path.join(tmp, "nexus-agent");
  const legacy = path.join(tmp, "does-not-exist");

  const res = migrateLegacyHermesHome({ home, legacySources: [legacy] });
  assert.equal(res.migrated, true);
  assert.deepEqual(res.moved, []);
  assert.equal(exists(home), true);
  assert.equal(exists(path.join(home, MIGRATION_MARKER)), true);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("windows-style: drains two legacy sources into one home", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-"));
  const home = path.join(tmp, "nexus-agent");
  const localHermes = path.join(tmp, "LOCALAPPDATA-hermes");
  const dotHermes = path.join(tmp, "dot-hermes");

  makeTree(localHermes);
  writeFile(localHermes, "state.db", "from-localappdata");
  makeTree(dotHermes);
  writeFile(dotHermes, ".env", "from-dothermes");

  const res = migrateLegacyHermesHome({
    home,
    legacySources: [localHermes, dotHermes],
  });
  assert.equal(res.migrated, true);
  assert.equal(exists(path.join(home, "state.db")), true);
  assert.equal(exists(path.join(home, ".env")), true);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("sidecar version stamp: migrates when absent, keeps new home's on collision", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-"));
  const home = path.join(tmp, "nexus-agent");
  const legacy = path.join(tmp, "hermes");

  makeTree(legacy);
  writeFile(legacy, ".env", "SECRET=1");
  writeFile(path.join(legacy, "gateway"), "sidecar-version.json", '{"version":"v0.3.1"}');
  writeFile(path.join(legacy, "gateway"), "old-binary", "x");

  // New home already carries its own version stamp -> legacy's must NOT overwrite.
  writeFile(path.join(home, "gateway"), "sidecar-version.json", '{"version":"v0.4.7"}');

  const res = migrateLegacyHermesHome({ home, legacySources: [legacy] });
  assert.equal(
    fs.readFileSync(path.join(home, "gateway", "sidecar-version.json"), "utf8"),
    '{"version":"v0.4.7"}',
  );
  // Collision: legacy's stamp is left behind, not clobbered over the new home's.
  assert.equal(exists(path.join(legacy, "gateway", "sidecar-version.json")), true);
  // The binary is still left behind (gateway/ stays dedup).
  assert.equal(exists(path.join(home, "gateway", "old-binary")), false);
  assert.equal(exists(path.join(legacy, "gateway", "old-binary")), true);
  assert.equal(res.migrated, true);

  fs.rmSync(tmp, { recursive: true, force: true });
});
