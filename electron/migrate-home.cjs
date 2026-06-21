// One-time drain of a legacy data home into the unified NEXUS_AGENT_HOME.
//
// Pure module: depends only on node:fs / node:path. electron/main.cjs computes
// the concrete home and the platform-aware legacy source list (Windows can have
// both %LOCALAPPDATA%\hermes and ~/.hermes) and passes them in; the test in
// electron/migrate-home.test.cjs drives temp dirs. Keeping this out of main.cjs
// lets the migration logic be unit-tested without booting Electron.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

// New home already holds a canonical copy of these — never overwrite.
const DEDUP = new Set(["cron", "gateway"]);
// Cache / regenerable / transient — leave in legacy, don't migrate.
const DISCARD = new Set([
  "cache",
  "image_cache",
  "audio_cache",
  "bootstrap-cache",
  "state-snapshots",
  "bin",
  "models_dev_cache.json",
  "ollama_cloud_models_cache.json",
  "provider_models_cache.json",
  "auth.lock",
  "kanban.db.init.lock",
  ".clean_shutdown",
  ".update_check",
  "gui.log",
  "errors.log",
]);

const MIGRATION_MARKER = ".migrated-from-hermes";

function directoryExists(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Per-file merge of a legacy logs/ dir: bring desktop.log (and any other log)
// over, keep the live gateway.log, and drop the stale gui.log/errors.log.
function drainLogs(srcLogs, dstLogs, moved) {
  if (!directoryExists(srcLogs)) return;
  fs.mkdirSync(dstLogs, { recursive: true });
  for (const le of fs.readdirSync(srcLogs, { withFileTypes: true })) {
    if (
      le.name === "gateway.log" ||
      le.name === "gui.log" ||
      le.name === "errors.log"
    ) {
      continue;
    }
    const s = path.join(srcLogs, le.name);
    const d = path.join(dstLogs, le.name);
    try {
      if (fs.existsSync(d)) continue;
      fs.renameSync(s, d);
      moved.push(`logs/${le.name}`);
    } catch (err) {
      console.warn(`[nexus] migrate logs: ${le.name}: ${err.message}`);
    }
  }
}

// opts.home          — the unified home to drain into (created if absent).
// opts.legacySources — ordered array of legacy dirs to drain; the new home wins
//                      any collision, so order only matters when two legacy dirs
//                      both hold the same name.
// Returns { migrated, moved } — migrated is false when the marker already existed
// (so a legacy-free machine still gets a marker written on first run, but a
// second run is a no-op).
function migrateLegacyHermesHome({ home, legacySources }) {
  const marker = path.join(home, MIGRATION_MARKER);
  if (fs.existsSync(marker)) return { migrated: false, moved: [] };

  fs.mkdirSync(home, { recursive: true });
  const moved = [];
  for (const legacy of legacySources) {
    if (!directoryExists(legacy)) continue;
    let entries;
    try {
      entries = fs.readdirSync(legacy, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const name = ent.name;
      if (DEDUP.has(name) || DISCARD.has(name)) continue;
      if (name === "logs") {
        drainLogs(path.join(legacy, "logs"), path.join(home, "logs"), moved);
        continue;
      }
      // Everything else (config.yaml, state.db*, .env, skills/, memories/,
      // sessions/, … and any unrecognised entry) is user data — move it,
      // preserving the new home's copy on collision.
      const src = path.join(legacy, name);
      const dst = path.join(home, name);
      try {
        if (fs.existsSync(dst)) continue;
        fs.renameSync(src, dst);
        moved.push(name);
      } catch (err) {
        console.warn(`[nexus] migrate: ${name}: ${err.message}`);
      }
    }
  }

  // Record completion even if nothing moved, so a legacy-free machine doesn't
  // rescan on every launch.
  try {
    fs.writeFileSync(marker, String(Date.now()));
  } catch (err) {
    console.warn(`[nexus] migrate: could not write marker: ${err.message}`);
  }
  return { migrated: true, moved };
}

module.exports = {
  migrateLegacyHermesHome,
  DEDUP,
  DISCARD,
  MIGRATION_MARKER,
};
