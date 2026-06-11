'use strict'

/**
 * sidecar-manager.cjs
 *
 * Manages the agent-gateway sidecar binary lifecycle:
 *   - Version tracking via sidecar-version.json
 *   - Download from GitHub Releases (ryanlq/agent-gateway)
 *   - Update checking and atomic binary replacement
 *
 * Used by electron/main.cjs for sidecar resolution and update IPC.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const GITHUB_REPO = 'ryanlq/agent-gateway'
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

// sidecar-version.json schema:
// { schemaVersion: 1, version: "v0.3.1", platform: "linux", arch: "amd64",
//   downloadedAt: "2026-06-11T...", source: "github" }
const VERSION_SCHEMA = 1

// ---------------------------------------------------------------------------
// Platform helpers
// ---------------------------------------------------------------------------

function sidecarFilename() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  if (process.platform === 'win32') return `agent-gateway-windows-${arch}.exe`
  if (process.platform === 'darwin') return `agent-gateway-macos-${arch}`
  return `agent-gateway-linux-${arch}`
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function sidecarDownloadDir(nexusHome) {
  return path.join(nexusHome, 'gateway')
}

function sidecarVersionPath(nexusHome) {
  return path.join(sidecarDownloadDir(nexusHome), 'sidecar-version.json')
}

function sidecarBinaryPath(nexusHome) {
  return path.join(sidecarDownloadDir(nexusHome), sidecarFilename())
}

function readInstalledVersion(nexusHome) {
  const p = sidecarVersionPath(nexusHome)
  try {
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && parsed.version) {
      return parsed
    }
  } catch {
    // missing or malformed
  }
  return null
}

function writeInstalledVersion(nexusHome, info) {
  const dir = sidecarDownloadDir(nexusHome)
  fs.mkdirSync(dir, { recursive: true })
  const payload = {
    schemaVersion: VERSION_SCHEMA,
    version: info.version,
    platform: info.platform || process.platform,
    arch: info.arch || (process.arch === 'arm64' ? 'arm64' : 'amd64'),
    downloadedAt: new Date().toISOString(),
    source: info.source || 'github',
  }
  const tmpPath = sidecarVersionPath(nexusHome) + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  fs.renameSync(tmpPath, sidecarVersionPath(nexusHome))
  return payload
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the best available sidecar binary. Priority:
 *   1. {nexusHome}/gateway/{filename} — downloaded/updated binary
 *   2. {resourcesPath}/gateway/{filename} — bundled binary (packaged app)
 *   3. {appRoot}/../build/sidecar/{filename} — dev mode
 * Returns the absolute path, or null when nothing is found.
 */
function resolveSidecarBinaryPaths(nexusHome, resourcesPath, appRoot) {
  const filename = sidecarFilename()
  const candidates = [
    path.join(nexusHome, 'gateway', filename),
    resourcesPath ? path.join(path.resolve(resourcesPath), 'gateway', filename) : null,
    path.join(appRoot, '..', 'build', 'sidecar', filename),
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.R_OK)
      return candidate
    } catch {
      // not found or not readable
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------

function httpsGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'hermes-desktop-sidecar-manager' },
      timeout: timeoutMs || 10_000,
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        httpsGetJson(res.headers.location, timeoutMs).then(resolve).catch(reject)
        res.resume()
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`GitHub API returned HTTP ${res.statusCode} for ${url}`))
        return
      }
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (err) {
          reject(new Error(`Failed to parse GitHub API response: ${err.message}`))
        }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error(`GitHub API request timed out (${timeoutMs || 10_000}ms)`))
    })
  })
}

function fetchLatestRelease() {
  return httpsGetJson(RELEASES_API, 10_000).catch((err) => {
    // Return null on failure — callers treat this as "no info available"
    return null
  })
}

function findAssetForPlatform(release) {
  if (!release || !Array.isArray(release.assets)) return null
  const filename = sidecarFilename()
  const asset = release.assets.find((a) => a && a.name === filename)
  if (!asset) return null
  return {
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size || 0,
  }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

function downloadBinary(url, destPath, options = {}) {
  return new Promise((resolve, reject) => {
    const tmpPath = destPath + `.tmp-${crypto.randomBytes(6).toString('hex')}`
    const out = fs.createWriteStream(tmpPath)
    let downloaded = 0
    let redirectCount = 0
    const maxRedirects = 5

    function doRequest(requestUrl) {
      if (redirectCount >= maxRedirects) {
        out.close()
        try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
        reject(new Error(`Too many redirects (${maxRedirects})`))
        return
      }

      const req = https.get(requestUrl, {
        headers: { 'User-Agent': 'hermes-desktop-sidecar-manager' },
      }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
          redirectCount++
          res.resume()
          doRequest(res.headers.location)
          return
        }
        if (res.statusCode !== 200) {
          out.close()
          try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
          reject(new Error(`Download failed: HTTP ${res.statusCode}`))
          return
        }

        res.on('data', (chunk) => {
          downloaded += chunk.length
          if (options.onProgress) {
            options.onProgress({ bytesDownloaded: downloaded, totalBytes: options.expectedSize || 0 })
          }
        })

        res.pipe(out)
        out.on('finish', () => {
          out.close()
          // chmod +x on POSIX
          if (process.platform !== 'win32') {
            try { fs.chmodSync(tmpPath, 0o755) } catch { /* best effort */ }
          }
          try {
            fs.renameSync(tmpPath, destPath)
          } catch (err) {
            try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
            reject(err)
            return
          }
          resolve(destPath)
        })
        out.on('error', (err) => {
          try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
          reject(err)
        })
      })

      req.on('error', (err) => {
        try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
        reject(err)
      })

      if (options.abortSignal) {
        const onAbort = () => { req.destroy(new Error('Download cancelled')) }
        if (options.abortSignal.aborted) { onAbort(); return }
        options.abortSignal.addEventListener('abort', onAbort, { once: true })
      }
    }

    doRequest(url)
  })
}

// ---------------------------------------------------------------------------
// Update check + download
// ---------------------------------------------------------------------------

async function checkForUpdate(nexusHome) {
  const installed = readInstalledVersion(nexusHome)
  let release
  try {
    release = await fetchLatestRelease()
  } catch (err) {
    return {
      updateAvailable: false,
      currentVersion: installed ? installed.version : null,
      latestVersion: null,
      error: err.message,
    }
  }
  if (!release || !release.tag_name) {
    return {
      updateAvailable: false,
      currentVersion: installed ? installed.version : null,
      latestVersion: null,
      error: release ? 'No tag_name in release response' : 'Failed to fetch release info',
    }
  }

  const asset = findAssetForPlatform(release)
  const currentVersion = installed ? installed.version : null
  const latestVersion = release.tag_name
  const updateAvailable = currentVersion !== latestVersion && !!asset

  return { updateAvailable, currentVersion, latestVersion, asset }
}

async function downloadAndUpdate(nexusHome, options = {}) {
  let release
  try {
    release = await fetchLatestRelease()
  } catch (err) {
    return { ok: false, error: `Failed to fetch latest release: ${err.message}` }
  }

  if (!release || !release.tag_name) {
    return { ok: false, error: 'No valid release found on GitHub' }
  }

  const asset = findAssetForPlatform(release)
  if (!asset) {
    return { ok: false, error: `No matching binary found for platform ${process.platform}/${process.arch}` }
  }

  const destPath = sidecarBinaryPath(nexusHome)
  const dir = sidecarDownloadDir(nexusHome)
  fs.mkdirSync(dir, { recursive: true })

  try {
    await downloadBinary(asset.url, destPath, {
      expectedSize: asset.size,
      abortSignal: options.abortSignal || null,
      onProgress: options.onProgress || null,
    })
  } catch (err) {
    return { ok: false, error: `Download failed: ${err.message}` }
  }

  writeInstalledVersion(nexusHome, {
    version: release.tag_name,
    source: 'github',
  })

  return { ok: true, version: release.tag_name }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  sidecarFilename,
  resolveSidecarBinaryPaths,
  readInstalledVersion,
  writeInstalledVersion,
  fetchLatestRelease,
  findAssetForPlatform,
  checkForUpdate,
  downloadAndUpdate,
}
