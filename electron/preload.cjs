const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('nexusAgent', {
  getConnection: profile => ipcRenderer.invoke('nexus:connection', profile),
  touchBackend: profile => ipcRenderer.invoke('nexus:backend:touch', profile),
  getGatewayWsUrl: profile => ipcRenderer.invoke('nexus:gateway:ws-url', profile),
  getBootProgress: () => ipcRenderer.invoke('nexus:boot-progress:get'),
  getConnectionConfig: profile => ipcRenderer.invoke('nexus:connection-config:get', profile),
  saveConnectionConfig: payload => ipcRenderer.invoke('nexus:connection-config:save', payload),
  applyConnectionConfig: payload => ipcRenderer.invoke('nexus:connection-config:apply', payload),
  testConnectionConfig: payload => ipcRenderer.invoke('nexus:connection-config:test', payload),
  probeConnectionConfig: remoteUrl => ipcRenderer.invoke('nexus:connection-config:probe', remoteUrl),
  oauthLoginConnectionConfig: remoteUrl => ipcRenderer.invoke('nexus:connection-config:oauth-login', remoteUrl),
  oauthLogoutConnectionConfig: remoteUrl => ipcRenderer.invoke('nexus:connection-config:oauth-logout', remoteUrl),
  profile: {
    get: () => ipcRenderer.invoke('nexus:profile:get'),
    set: name => ipcRenderer.invoke('nexus:profile:set', name)
  },
  api: request => ipcRenderer.invoke('nexus:api', request),
  notify: payload => ipcRenderer.invoke('nexus:notify', payload),
  requestMicrophoneAccess: () => ipcRenderer.invoke('nexus:requestMicrophoneAccess'),
  readFileDataUrl: filePath => ipcRenderer.invoke('nexus:readFileDataUrl', filePath),
  readFileText: filePath => ipcRenderer.invoke('nexus:readFileText', filePath),
  selectPaths: options => ipcRenderer.invoke('nexus:selectPaths', options),
  writeClipboard: text => ipcRenderer.invoke('nexus:writeClipboard', text),
  saveImageFromUrl: url => ipcRenderer.invoke('nexus:saveImageFromUrl', url),
  saveImageBuffer: (data, ext) => ipcRenderer.invoke('nexus:saveImageBuffer', { data, ext }),
  saveClipboardImage: () => ipcRenderer.invoke('nexus:saveClipboardImage'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('nexus:normalizePreviewTarget', target, baseDir),
  watchPreviewFile: url => ipcRenderer.invoke('nexus:watchPreviewFile', url),
  stopPreviewFileWatch: id => ipcRenderer.invoke('nexus:stopPreviewFileWatch', id),
  setTitleBarTheme: payload => ipcRenderer.send('nexus:titlebar-theme', payload),
  setPreviewShortcutActive: active => ipcRenderer.send('nexus:previewShortcutActive', Boolean(active)),
  openExternal: url => ipcRenderer.invoke('nexus:openExternal', url),
  fetchLinkTitle: url => ipcRenderer.invoke('nexus:fetchLinkTitle', url),
  settings: {
    getDefaultProjectDir: () => ipcRenderer.invoke('nexus:setting:defaultProjectDir:get'),
    setDefaultProjectDir: dir => ipcRenderer.invoke('nexus:setting:defaultProjectDir:set', dir),
    pickDefaultProjectDir: () => ipcRenderer.invoke('nexus:setting:defaultProjectDir:pick')
  },
  revealLogs: () => ipcRenderer.invoke('nexus:logs:reveal'),
  getRecentLogs: () => ipcRenderer.invoke('nexus:logs:recent'),
  readDir: dirPath => ipcRenderer.invoke('nexus:fs:readDir', dirPath),
  gitRoot: startPath => ipcRenderer.invoke('nexus:fs:gitRoot', startPath),
  terminal: {
    dispose: id => ipcRenderer.invoke('nexus:terminal:dispose', id),
    resize: (id, size) => ipcRenderer.invoke('nexus:terminal:resize', id, size),
    start: options => ipcRenderer.invoke('nexus:terminal:start', options),
    write: (id, data) => ipcRenderer.invoke('nexus:terminal:write', id, data),
    onData: (id, callback) => {
      const channel = `nexus:terminal:${id}:data`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id, callback) => {
      const channel = `nexus:terminal:${id}:exit`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  onClosePreviewRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('nexus:close-preview-requested', listener)
    return () => ipcRenderer.removeListener('nexus:close-preview-requested', listener)
  },
  onWindowStateChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('nexus:window-state-changed', listener)
    return () => ipcRenderer.removeListener('nexus:window-state-changed', listener)
  },
  onPreviewFileChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('nexus:preview-file-changed', listener)
    return () => ipcRenderer.removeListener('nexus:preview-file-changed', listener)
  },
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('nexus:backend-exit', listener)
    return () => ipcRenderer.removeListener('nexus:backend-exit', listener)
  },
  onPowerResume: callback => {
    const listener = () => callback()
    ipcRenderer.on('nexus:power-resume', listener)
    return () => ipcRenderer.removeListener('nexus:power-resume', listener)
  },
  onBootProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('nexus:boot-progress', listener)
    return () => ipcRenderer.removeListener('nexus:boot-progress', listener)
  },
  // NOTE: bootstrap IPC methods removed — legacy bootstrap path retired.
  getVersion: () => ipcRenderer.invoke('nexus:version'),
  sidecar: {
    checkUpdate: () => ipcRenderer.invoke('nexus:sidecar:check-update'),
    update: () => ipcRenderer.invoke('nexus:sidecar:update'),
    getVersion: () => ipcRenderer.invoke('nexus:sidecar:version'),
    onUpdateAvailable: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('nexus:sidecar:update-available', listener)
      return () => ipcRenderer.removeListener('nexus:sidecar:update-available', listener)
    },
  },
  desktopUpdates: {
    check: () => ipcRenderer.invoke('nexus:desktop-update:check'),
    status: () => ipcRenderer.invoke('nexus:desktop-update:status'),
    download: () => ipcRenderer.invoke('nexus:desktop-update:download'),
    apply: () => ipcRenderer.invoke('nexus:desktop-update:apply'),
    onProgress: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('nexus:desktop-update:progress', listener)
      return () => ipcRenderer.removeListener('nexus:desktop-update:progress', listener)
    },
  },
})
