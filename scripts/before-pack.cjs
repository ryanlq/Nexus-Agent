'use strict'

/**
 * before-pack.cjs — electron-builder beforePack hook.
 *
 * Runs two independent pre-pack steps:
 *
 *  1. Removes any stale unpacked app directory (`appOutDir`) before
 *     electron-builder stages the Electron binaries into it.
 *
 *     WHY THIS EXISTS
 *     ---------------
 *     electron-builder's final packaging step copies the stock `electron`
 *     binary into `release/<platform>-unpacked/` and then renames it to the
 *     product name (`Hermes`). If a PREVIOUS `npm run pack` was interrupted
 *     (Ctrl-C, OOM kill, crash, full disk) the unpacked directory is left in
 *     a corrupted partial state: it keeps the already-renamed
 *     `LICENSE.electron.txt` and the Chromium payload (.pak/.so/icudtl.dat/
 *     chrome-sandbox) but is MISSING the `electron` binary itself.
 *
 *     On the next run, electron-builder sees the destination directory already
 *     populated, skips re-copying the binary it thinks is present, then tries
 *     to rename a `electron` file that no longer exists. The build dies with:
 *
 *       ENOENT: no such file or directory, rename
 *       '.../release/linux-unpacked/electron' -> '.../release/linux-unpacked/Hermes'
 *
 *     This is a hard failure with no obvious cause for the user — `hermes
 *     desktop` just prints "Desktop GUI build failed" and the only fix is to
 *     manually `rm -rf` the release directory, which a normal user has no way
 *     to know. The packaging step is not idempotent across an interrupted run,
 *     so we make it idempotent ourselves: wipe the target unpacked directory
 *     up front so electron-builder always stages into a clean tree. This is
 *     safe — the directory is a pure build artifact that electron-builder
 *     fully recreates on every pack; nothing else depends on its prior
 *     contents.
 *
 *     Cross-platform: the same partial-state trap exists on macOS (the
 *     mac-unpacked Hermes.app bundle) and Windows (win-unpacked), so we clean
 *     whatever `appOutDir` electron-builder hands us regardless of platform.
 *
 *     Best-effort: a cleanup failure must never mask the real build. We log
 *     and resolve rather than throw — worst case electron-builder hits the
 *     original ENOENT, which is no worse than not having this hook at all.
 *
 *  2. Stages the prebuilt agent-gateway sidecar binary for the target
 *     platform into `build/sidecar/` so package.json's extraResources can
 *     bundle it as `resources/gateway/<binary>`. Source is the sibling
 *     checkout at `../agent-gateway/dist/` (uploaded to GitHub Releases by
 *     the gateway CI). Missing source = skipped, not failed, so developer
 *     machines without the gateway checkout still produce a working desktop
 *     package that falls back to the venv / env-var backend resolution.
 *
 * electron-builder passes a context with:
 *   - appOutDir:            the unpacked app directory about to be staged
 *   - electronPlatformName: 'win32' | 'darwin' | 'linux'
 *   - arch:                 Arch instance (arch.name === 'x64' | 'arm64' | …)
 */

const fs = require('node:fs')
const path = require('node:path')

function cleanStaleAppOutDir(appOutDir) {
  if (!appOutDir || typeof appOutDir !== 'string') {
    return false
  }
  if (!fs.existsSync(appOutDir)) {
    return false
  }
  // Recursive + force so a half-written tree (read-only bits, partial files)
  // can't block the wipe. retry/maxRetries rides out transient EBUSY on
  // Windows where an AV/indexer may briefly hold a handle.
  fs.rmSync(appOutDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  return true
}

// Map electron-builder platform/arch to the sidecar filename produced by the
// agent-gateway CI build. Filenames follow `<name>-<os>-<arch>[.exe]`; the
// Windows binary carries the `.exe` suffix that Windows needs to execute it.
// Returns null for an unrecognized platform so the caller skips staging
// cleanly instead of shipping a linux binary by mistake.
function sidecarFilename(electronPlatformName, archName) {
  const arch = archName === 'arm64' ? 'arm64' : 'amd64'
  if (electronPlatformName === 'win32') return `agent-gateway-windows-${arch}.exe`
  if (electronPlatformName === 'darwin') return `agent-gateway-macos-${arch}`
  if (electronPlatformName === 'linux') return `agent-gateway-linux-${arch}`
  return null
}

// Stage the sidecar binary matching the electron-builder target into
// <projectRoot>/build/sidecar/. Returns { staged: true, source, target } on
// success, or { staged: false, reason } when skipped — callers (and tests)
// can branch on `staged` without parsing log strings.
function stageSidecar({ electronPlatformName, archName, projectRoot }) {
  const root = projectRoot || process.cwd()
  const filename = sidecarFilename(electronPlatformName, archName || 'x64')

  if (!filename) {
    return { staged: false, reason: `unsupported electronPlatformName: ${electronPlatformName}` }
  }

  const source = path.resolve(root, '..', 'agent-gateway', 'dist', filename)

  if (!fs.existsSync(source)) {
    return { staged: false, reason: `sidecar source missing: ${source}` }
  }

  const targetDir = path.resolve(root, 'build', 'sidecar')
  fs.mkdirSync(targetDir, { recursive: true })

  // Wipe any stale binaries from a previous pack for a different platform —
  // extraResources copies the whole directory, so leftover files from a
  // win32 build would leak into a subsequent linux build otherwise.
  for (const entry of fs.readdirSync(targetDir)) {
    try {
      fs.rmSync(path.join(targetDir, entry), { recursive: true, force: true })
    } catch {
      // Best-effort cleanup; a lingering file surfaces as a warning, not a
      // build failure.
    }
  }

  const target = path.join(targetDir, filename)
  fs.copyFileSync(source, target)
  // Preserve executable bit on POSIX — copyFileSync keeps mode bits in
  // theory, but Windows-NTFS round-trips can strip them, and an un-executable
  // sidecar is a silent launch failure that's painful to diagnose.
  if (electronPlatformName !== 'win32') {
    try {
      fs.chmodSync(target, 0o755)
    } catch {
      // Non-fatal: main.cjs re-chmods before spawn as a belt-and-braces step.
    }
  }

  return { staged: true, source, target }
}

exports.cleanStaleAppOutDir = cleanStaleAppOutDir
exports.stageSidecar = stageSidecar
exports.sidecarFilename = sidecarFilename

exports.default = async function beforePack(context) {
  const appOutDir = context && context.appOutDir
  try {
    if (cleanStaleAppOutDir(appOutDir)) {
      console.log(`[before-pack] removed stale unpacked dir before staging: ${appOutDir}`)
    }
  } catch (err) {
    // Never fail the build over cleanup; surface why so a genuinely stuck
    // directory (permissions, mount) is still diagnosable.
    console.warn(`[before-pack] could not clean ${appOutDir} (${err.message}); continuing`)
  }

  const electronPlatformName = context && context.electronPlatformName
  const archName = context && context.arch && context.arch.name
  if (!electronPlatformName) {
    console.warn('[before-pack] no electronPlatformName in context; skipping sidecar staging')
    return
  }

  try {
    const result = stageSidecar({ electronPlatformName, archName })
    if (result.staged) {
      console.log(`[before-pack] staged sidecar ${path.basename(result.target)} from ${result.source}`)
    } else {
      console.warn(`[before-pack] sidecar not staged (${result.reason}); build will fall back to venv backend`)
      // Ensure the directory exists (even if empty) so that extraResources
      // in package.json ("from": "build/sidecar") never fails with "not a file"
      // on CI where the prebuilt sidecar binary is absent.
      const targetDir = path.resolve(process.cwd(), 'build', 'sidecar')
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true })
      }
    }
  } catch (err) {
    console.warn(`[before-pack] sidecar staging failed (${err.message}); continuing with fallback backend`)
    // Belt-and-braces: ensure dir exists even on unexpected errors.
    try {
      const targetDir = path.resolve(process.cwd(), 'build', 'sidecar')
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true })
      }
    } catch { /* non-fatal */ }
  }
}
