/**
 * Sidecar (agent-gateway) version + update store.
 * Tracks the installed gateway version, checks for updates, and surfaces
 * update availability to the UI.
 */

import { atom } from 'nanostores'

import type { SidecarUpdateCheck, SidecarUpdateResult, SidecarVersion } from '@/global'
import { translateNow } from '@/i18n'
import { notify, dismissNotification } from '@/store/notifications'

export const $sidecarVersion = atom<SidecarVersion | null>(null)
export const $sidecarUpdateCheck = atom<SidecarUpdateCheck | null>(null)
export const $sidecarUpdating = atom<boolean>(false)
export const $sidecarChecking = atom<boolean>(false)

const SIDECAR_UPDATE_TOAST_ID = 'sidecar-update-available'

export function maybeNotifySidecarUpdate(check: SidecarUpdateCheck): void {
  if (!check.updateAvailable || check.error) {
    return
  }

  dismissNotification(SIDECAR_UPDATE_TOAST_ID)

  notify({
    action: {
      label: translateNow('notifications.updateGateway'),
      onClick: () => void applySidecarUpdate()
    },
    durationMs: 0,
    id: SIDECAR_UPDATE_TOAST_ID,
    kind: 'info',
    message: translateNow('notifications.gatewayUpdateMessage', check.latestVersion ?? ''),
    onDismiss: () => dismissNotification(SIDECAR_UPDATE_TOAST_ID),
    title: translateNow('notifications.gatewayUpdateTitle')
  })
}

export async function refreshSidecarVersion(): Promise<SidecarVersion | null> {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const next = await window.nexusAgent?.sidecar?.getVersion?.()

    if (next) {
      $sidecarVersion.set(next)
    }

    return next ?? null
  } catch {
    return null
  }
}

export async function checkSidecarUpdate(): Promise<SidecarUpdateCheck | null> {
  const bridge = window.nexusAgent?.sidecar

  if (!bridge || $sidecarChecking.get()) {
    return $sidecarUpdateCheck.get()
  }

  $sidecarChecking.set(true)

  try {
    const check = await bridge.checkUpdate()
    $sidecarUpdateCheck.set(check)

    if (check.updateAvailable) {
      maybeNotifySidecarUpdate(check)
    }

    return check
  } catch {
    const fallback: SidecarUpdateCheck = {
      updateAvailable: false,
      currentVersion: $sidecarVersion.get()?.version ?? null,
      latestVersion: null,
      error: 'check-failed'
    }

    $sidecarUpdateCheck.set(fallback)

    return fallback
  } finally {
    $sidecarChecking.set(false)
  }
}

export async function applySidecarUpdate(): Promise<SidecarUpdateResult> {
  const bridge = window.nexusAgent?.sidecar

  if (!bridge) {
    return { ok: false, error: 'unavailable' }
  }

  dismissNotification(SIDECAR_UPDATE_TOAST_ID)
  $sidecarUpdating.set(true)

  try {
    const result = await bridge.update()

    if (result.ok) {
      // Re-read version after successful update
      void refreshSidecarVersion()
      $sidecarUpdateCheck.set(null)
    }

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    return { ok: false, error: 'update-failed', message }
  } finally {
    $sidecarUpdating.set(false)
  }
}

let sidecarListenerStarted = false

/**
 * Wire up the push-based update-available event from main process.
 * Idempotent — safe to call multiple times.
 */
export function startSidecarListener(): void {
  if (sidecarListenerStarted || typeof window === 'undefined') {
    return
  }

  const bridge = window.nexusAgent?.sidecar

  if (!bridge) {
    return
  }

  sidecarListenerStarted = true

  bridge.onUpdateAvailable(info => {
    $sidecarUpdateCheck.set(info)
    maybeNotifySidecarUpdate(info)
  })

  // Also fetch the current version on init
  void refreshSidecarVersion()
}
