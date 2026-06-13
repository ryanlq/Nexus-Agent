import { atom } from 'nanostores'

import type { DesktopUpdateProgress, DesktopUpdateStatus } from '@/global'
import { translateNow } from '@/i18n'
import { dismissNotification, notify } from '@/store/notifications'

export const $desktopUpdateStatus = atom<DesktopUpdateStatus>({
  stage: 'idle',
  error: null,
  percent: 0,
  info: null,
})

const DESKTOP_UPDATE_TOAST_ID = 'desktop-update-available'
const DESKTOP_UPDATE_READY_TOAST_ID = 'desktop-update-ready'

export function maybeNotifyDesktopUpdate(status: DesktopUpdateStatus): void {
  if (status.stage === 'available' && !status.error) {
    dismissNotification(DESKTOP_UPDATE_TOAST_ID)

    notify({
      action: {
        label: translateNow('notifications.downloadUpdate'),
        onClick: () => void downloadDesktopUpdate(),
      },
      durationMs: 0,
      id: DESKTOP_UPDATE_TOAST_ID,
      kind: 'info',
      message: translateNow('notifications.desktopUpdateMessage', status.info?.version ?? ''),
      onDismiss: () => dismissNotification(DESKTOP_UPDATE_TOAST_ID),
      title: translateNow('notifications.desktopUpdateTitle'),
    })
  }

  if (status.stage === 'downloaded' && !status.error) {
    dismissNotification(DESKTOP_UPDATE_TOAST_ID)
    dismissNotification(DESKTOP_UPDATE_READY_TOAST_ID)

    notify({
      action: {
        label: translateNow('notifications.restartToUpdate'),
        onClick: () => void applyDesktopUpdate(),
      },
      durationMs: 0,
      id: DESKTOP_UPDATE_READY_TOAST_ID,
      kind: 'info',
      message: translateNow('notifications.desktopUpdateMessage', status.info?.version ?? ''),
      onDismiss: () => dismissNotification(DESKTOP_UPDATE_READY_TOAST_ID),
      title: translateNow('notifications.desktopUpdateTitle'),
    })
  }
}

export async function checkDesktopUpdate(): Promise<DesktopUpdateStatus> {
  const bridge = window.nexusAgent?.desktopUpdates

  if (!bridge) {
    return $desktopUpdateStatus.get()
  }

  const status = await bridge.check()
  $desktopUpdateStatus.set(status)

  if (status.stage === 'available' || status.stage === 'downloaded') {
    maybeNotifyDesktopUpdate(status)
  }

  return status
}

export async function downloadDesktopUpdate(): Promise<{ ok: boolean; error?: string }> {
  const bridge = window.nexusAgent?.desktopUpdates

  if (!bridge) {
    return { ok: false, error: 'unavailable' }
  }

  dismissNotification(DESKTOP_UPDATE_TOAST_ID)
  return bridge.download()
}

export async function applyDesktopUpdate(): Promise<{ ok: boolean; error?: string }> {
  const bridge = window.nexusAgent?.desktopUpdates

  if (!bridge) {
    return { ok: false, error: 'unavailable' }
  }

  return bridge.apply()
}

let desktopUpdateListenerStarted = false

export function startDesktopUpdateListener(): void {
  if (desktopUpdateListenerStarted || typeof window === 'undefined') {
    return
  }

  const bridge = window.nexusAgent?.desktopUpdates

  if (!bridge) {
    return
  }

  desktopUpdateListenerStarted = true

  bridge.onProgress((progress: DesktopUpdateProgress) => {
    const status: DesktopUpdateStatus = {
      stage: progress.stage,
      error: progress.error,
      percent: progress.percent,
      info: progress.info,
    }
    $desktopUpdateStatus.set(status)

    if (status.stage === 'available' || status.stage === 'downloaded') {
      maybeNotifyDesktopUpdate(status)
    }
  })

  void checkDesktopUpdate()
}
