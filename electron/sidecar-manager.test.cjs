'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const {
  sidecarFilename,
  resolveSidecarBinaryPaths,
  readInstalledVersion,
  writeInstalledVersion,
  findAssetForPlatform,
} = require('./sidecar-manager.cjs')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-manager-test-'))
}

// ---------------------------------------------------------------------------
// sidecarFilename
// ---------------------------------------------------------------------------

describe('sidecarFilename', () => {
  it('returns a string containing the platform name', () => {
    const name = sidecarFilename()
    assert.ok(typeof name === 'string')
    assert.ok(name.startsWith('agent-gateway-'))
  })

  it('ends with .exe on windows-style platform name', () => {
    // We can't change process.platform, but we can verify the current platform
    const name = sidecarFilename()
    if (process.platform === 'win32') {
      assert.ok(name.endsWith('.exe'))
    } else {
      assert.ok(!name.endsWith('.exe'))
    }
  })
})

// ---------------------------------------------------------------------------
// readInstalledVersion / writeInstalledVersion
// ---------------------------------------------------------------------------

describe('readInstalledVersion / writeInstalledVersion', () => {
  it('returns null when no version file exists', () => {
    const dir = makeTempDir()
    const result = readInstalledVersion(dir)
    assert.equal(result, null)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips version info', () => {
    const dir = makeTempDir()
    const info = { version: 'v0.3.1', source: 'test' }
    const written = writeInstalledVersion(dir, info)
    assert.equal(written.version, 'v0.3.1')
    assert.equal(written.source, 'test')
    assert.equal(written.schemaVersion, 1)

    const read = readInstalledVersion(dir)
    assert.equal(read.version, 'v0.3.1')
    assert.equal(read.source, 'test')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('uses defaults for platform and arch', () => {
    const dir = makeTempDir()
    const written = writeInstalledVersion(dir, { version: 'v1.0.0' })
    assert.equal(written.platform, process.platform)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// findAssetForPlatform
// ---------------------------------------------------------------------------

describe('findAssetForPlatform', () => {
  it('returns null for null release', () => {
    assert.equal(findAssetForPlatform(null), null)
  })

  it('returns null for empty assets', () => {
    assert.equal(findAssetForPlatform({ assets: [] }), null)
  })

  it('finds the matching platform asset', () => {
    const filename = sidecarFilename()
    const release = {
      tag_name: 'v0.3.1',
      assets: [
        { name: 'agent-gateway-linux-amd64', browser_download_url: 'https://example.com/linux', size: 100 },
        { name: 'agent-gateway-macos-amd64', browser_download_url: 'https://example.com/macos', size: 200 },
        { name: 'agent-gateway-windows-amd64.exe', browser_download_url: 'https://example.com/win', size: 300 },
      ],
    }
    const result = findAssetForPlatform(release)
    assert.ok(result)
    assert.equal(result.name, filename)
    assert.ok(result.url.startsWith('https://'))
  })

  it('returns null when no matching asset exists', () => {
    const release = {
      tag_name: 'v0.3.1',
      assets: [
        { name: 'some-other-binary', browser_download_url: 'https://example.com/other', size: 100 },
      ],
    }
    assert.equal(findAssetForPlatform(release), null)
  })
})

// ---------------------------------------------------------------------------
// resolveSidecarBinaryPaths
// ---------------------------------------------------------------------------

describe('resolveSidecarBinaryPaths', () => {
  it('returns null when nothing exists', () => {
    const dir = makeTempDir()
    const result = resolveSidecarBinaryPaths(dir, '/nonexistent/resources', '/nonexistent/app')
    assert.equal(result, null)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('finds a binary in the nexusHome directory', () => {
    const dir = makeTempDir()
    const gatewayDir = path.join(dir, 'gateway')
    fs.mkdirSync(gatewayDir, { recursive: true })
    const binaryPath = path.join(gatewayDir, sidecarFilename())
    fs.writeFileSync(binaryPath, 'fake binary')
    const result = resolveSidecarBinaryPaths(dir, '/nonexistent/resources', '/nonexistent/app')
    assert.equal(result, binaryPath)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('prefers nexusHome over bundled binary', () => {
    const home = makeTempDir()
    const resources = makeTempDir()
    // Create binary in resources
    const resGwDir = path.join(resources, 'gateway')
    fs.mkdirSync(resGwDir, { recursive: true })
    fs.writeFileSync(path.join(resGwDir, sidecarFilename()), 'bundled binary')
    // Create binary in home (higher priority)
    const homeGwDir = path.join(home, 'gateway')
    fs.mkdirSync(homeGwDir, { recursive: true })
    const homeBinary = path.join(homeGwDir, sidecarFilename())
    fs.writeFileSync(homeBinary, 'downloaded binary')

    const result = resolveSidecarBinaryPaths(home, resources, '/nonexistent/app')
    assert.equal(result, homeBinary)
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(resources, { recursive: true, force: true })
  })

  it('falls back to bundled binary when no download exists', () => {
    const home = makeTempDir()
    const resources = makeTempDir()
    const resGwDir = path.join(resources, 'gateway')
    fs.mkdirSync(resGwDir, { recursive: true })
    const resBinary = path.join(resGwDir, sidecarFilename())
    fs.writeFileSync(resBinary, 'bundled binary')

    const result = resolveSidecarBinaryPaths(home, resources, '/nonexistent/app')
    assert.equal(result, resBinary)
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(resources, { recursive: true, force: true })
  })
})
