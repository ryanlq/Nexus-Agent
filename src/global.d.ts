export {}

declare global {
  interface Window {
    nexusAgent: {
      // Resolve a backend connection. Omit `profile` (or pass the primary) for
      // the window's backend; pass a named profile to lazily spawn/reuse that
      // profile's backend from the pool.
      getConnection: (profile?: string | null) => Promise<GatewayConnection>
      // Keepalive: mark a pool profile backend as recently used so the idle
      // reaper spares it while its chat is active.
      touchBackend: (profile?: string | null) => Promise<{ ok: boolean }>
      getGatewayWsUrl: (profile?: null | string) => Promise<string>
      getBootProgress: () => Promise<DesktopBootProgress>
      getConnectionConfig: (profile?: null | string) => Promise<DesktopConnectionConfig>
      saveConnectionConfig: (payload: DesktopConnectionConfigInput) => Promise<DesktopConnectionConfig>
      applyConnectionConfig: (payload: DesktopConnectionConfigInput) => Promise<DesktopConnectionConfig>
      testConnectionConfig: (payload: DesktopConnectionConfigInput) => Promise<DesktopConnectionTestResult>
      probeConnectionConfig: (remoteUrl: string) => Promise<DesktopConnectionProbeResult>
      oauthLoginConnectionConfig: (remoteUrl: string) => Promise<DesktopOauthLoginResult>
      oauthLogoutConnectionConfig: (remoteUrl?: string) => Promise<DesktopOauthLogoutResult>
      profile: {
        get: () => Promise<DesktopActiveProfile>
        // Persists the desktop's profile choice and relaunches the local
        // backend under the new HERMES_HOME (reloads the window). Pass null to
        // clear the preference.
        set: (name: string | null) => Promise<DesktopActiveProfile>
      }
      api: <T>(request: HermesApiRequest) => Promise<T>
      notify: (payload: HermesNotification) => Promise<boolean>
      requestMicrophoneAccess: () => Promise<boolean>
      readFileDataUrl: (filePath: string) => Promise<string>
      readFileText: (filePath: string) => Promise<HermesReadFileTextResult>
      selectPaths: (options?: HermesSelectPathsOptions) => Promise<string[]>
      writeClipboard: (text: string) => Promise<boolean>
      saveImageFromUrl: (url: string) => Promise<boolean>
      saveImageBuffer: (data: ArrayBuffer | Uint8Array, ext: string) => Promise<string>
      saveClipboardImage: () => Promise<string>
      getPathForFile: (file: File) => string
      normalizePreviewTarget: (target: string, baseDir?: string) => Promise<HermesPreviewTarget | null>
      watchPreviewFile: (url: string) => Promise<HermesPreviewWatch>
      stopPreviewFileWatch: (id: string) => Promise<boolean>
      setTitleBarTheme?: (payload: HermesTitleBarTheme) => void
      setPreviewShortcutActive?: (active: boolean) => void
      openExternal: (url: string) => Promise<void>
      fetchLinkTitle: (url: string) => Promise<string>
      settings: {
        getDefaultProjectDir: () => Promise<{ defaultLabel: string; dir: null | string }>
        pickDefaultProjectDir: () => Promise<{ canceled: boolean; dir: null | string }>
        setDefaultProjectDir: (dir: null | string) => Promise<{ dir: null | string }>
      }
      revealLogs: () => Promise<{ ok: boolean; path: string; error?: string }>
      getRecentLogs: () => Promise<{ path: string; lines: string[] }>
      readDir: (path: string) => Promise<HermesReadDirResult>
      gitRoot?: (path: string) => Promise<string | null>
      terminal: {
        dispose: (id: string) => Promise<boolean>
        onData: (id: string, callback: (payload: string) => void) => () => void
        onExit: (id: string, callback: (payload: HermesTerminalExit) => void) => () => void
        resize: (id: string, size: { cols: number; rows: number }) => Promise<boolean>
        start: (options?: { cols?: number; cwd?: string; rows?: number }) => Promise<HermesTerminalSession>
        write: (id: string, data: string) => Promise<boolean>
      }
      onClosePreviewRequested?: (callback: () => void) => () => void
      onWindowStateChanged?: (callback: (payload: HermesWindowState) => void) => () => void
      onPreviewFileChanged: (callback: (payload: HermesPreviewFileChanged) => void) => () => void
      onBackendExit: (callback: (payload: BackendExit) => void) => () => void
      onPowerResume?: (callback: () => void) => () => void
      onBootProgress: (callback: (payload: DesktopBootProgress) => void) => () => void
      // NOTE: bootstrap methods removed — legacy bootstrap path retired.
      getVersion: () => Promise<DesktopVersionInfo>
      sidecar: {
        checkUpdate: () => Promise<SidecarUpdateCheck>
        update: () => Promise<SidecarUpdateResult>
        getVersion: () => Promise<SidecarVersion | null>
        onUpdateAvailable: (callback: (info: SidecarUpdateCheck) => void) => () => void
      }
    }
  }
}

export interface HermesTerminalSession {
  cwd: string
  id: string
  shell: string
}

export interface HermesTerminalExit {
  code: number | null
  signal: string | null
}

export interface DesktopVersionInfo {
  appVersion: string
  electronVersion: string
  nodeVersion: string
  platform: string
}

export interface GatewayConnection {
  baseUrl: string
  isFullscreen: boolean
  mode?: 'local' | 'remote'
  authMode?: 'oauth' | 'token'
  nativeOverlayWidth: number
  source?: 'env' | 'local' | 'settings'
  token: string
  wsUrl: string
  logs: string[]
  // Set for pool (non-primary) backends so the renderer knows which profile a
  // connection belongs to.
  profile?: string
  windowButtonPosition: { x: number; y: number } | null
}

export interface HermesTitleBarTheme {
  background: string
  foreground: string
}

export interface HermesWindowState {
  isFullscreen: boolean
  nativeOverlayWidth: number
  windowButtonPosition: { x: number; y: number } | null
}

export interface DesktopActiveProfile {
  // The desktop's stored profile preference, or null when unset (legacy launch
  // that defers to the sticky active_profile / default).
  profile: string | null
}

export interface DesktopConnectionConfig {
  envOverride: boolean
  mode: 'local' | 'remote'
  // The profile this config describes, or null for the global/default
  // connection. Per-profile entries let a profile point at its own backend.
  profile: null | string
  remoteAuthMode: 'oauth' | 'token'
  remoteOauthConnected: boolean
  remoteTokenPreview: string | null
  remoteTokenSet: boolean
  remoteUrl: string
}

export interface DesktopConnectionConfigInput {
  mode: 'local' | 'remote'
  // When set, the save/apply/test targets this profile's per-profile remote
  // override instead of the global connection.
  profile?: null | string
  remoteAuthMode?: 'oauth' | 'token'
  remoteToken?: string
  remoteUrl?: string
}

export interface DesktopConnectionTestResult {
  baseUrl: string
  ok: boolean
  version: string | null
}

export interface DesktopAuthProvider {
  name: string
  displayName: string
  // True when this provider authenticates with a username + password
  // (the gateway's /login page renders a credential form) rather than an
  // OAuth redirect. The session/cookie/ws-ticket machinery is identical;
  // only the login-page form and the desktop's button copy differ.
  supportsPassword?: boolean
}

export interface DesktopConnectionProbeResult {
  baseUrl: string
  reachable: boolean
  authMode: 'oauth' | 'token' | 'unknown'
  providers: DesktopAuthProvider[]
  version: string | null
  error: string | null
}

export interface DesktopOauthLoginResult {
  ok: boolean
  baseUrl: string
  connected: boolean
}

export interface DesktopOauthLogoutResult {
  ok: boolean
  connected: boolean
}

export interface DesktopBootProgress {
  error: string | null
  fakeMode: boolean
  message: string
  phase: string
  progress: number
  running: boolean
  timestamp: number
}

// NOTE: DesktopBootstrap* types removed — legacy bootstrap path retired.

export interface HermesApiRequest {
  path: string
  method?: string
  body?: unknown
  timeoutMs?: number
  // Route this REST call to a specific profile's backend. Omit for the primary
  // (window) backend. Read-only cross-profile data is served by the primary, so
  // this is only needed for profile-scoped live/settings calls.
  profile?: string | null
}

export interface HermesNotification {
  title?: string
  body?: string
  silent?: boolean
}

export interface HermesPreviewTarget {
  binary?: boolean
  byteSize?: number
  kind: 'file' | 'url'
  label: string
  large?: boolean
  language?: string
  mimeType?: string
  path?: string
  previewKind?: 'binary' | 'html' | 'image' | 'text'
  renderMode?: 'preview' | 'source'
  source: string
  url: string
}

export interface HermesReadFileTextResult {
  binary?: boolean
  byteSize?: number
  language?: string
  mimeType?: string
  path: string
  text: string
  truncated?: boolean
}

export interface HermesPreviewWatch {
  id: string
  path: string
}

export interface HermesReadDirEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface HermesReadDirResult {
  entries: HermesReadDirEntry[]
  error?: string
}

export interface HermesPreviewFileChanged {
  id: string
  path: string
  url: string
}

export interface HermesSelectPathsOptions {
  title?: string
  defaultPath?: string
  directories?: boolean
  multiple?: boolean
  filters?: Array<{ name: string; extensions: string[] }>
}

export interface BackendExit {
  code: number | null
  signal: string | null
}

// Sidecar update types
export interface SidecarVersion {
  schemaVersion: number
  version: string
  platform: string
  arch: string
  downloadedAt: string
  source: string
}

export interface SidecarUpdateCheck {
  updateAvailable: boolean
  currentVersion: string | null
  latestVersion: string | null
  asset?: { name: string; url: string; size: number }
  error?: string
}

export interface SidecarUpdateResult {
  ok: boolean
  version?: string
  error?: string
  message?: string
}
