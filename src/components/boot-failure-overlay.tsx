import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { DesktopConnectionConfig } from '@/global'
import { useI18n } from '@/i18n'
import { AlertTriangle, Download, FileText, Loader2, LogIn, RefreshCw, Wrench } from '@/lib/icons'
import { $desktopBoot } from '@/store/boot'
import { notify, notifyError } from '@/store/notifications'
import { $desktopOnboarding } from '@/store/onboarding'
import { applySidecarUpdate, checkSidecarUpdate, $sidecarChecking, $sidecarUpdateCheck, $sidecarUpdating } from '@/store/sidecar'

import type { RemoteReauth } from './boot-failure-reauth'
import { deriveProviderShape, isRemoteReauthFailure, signInLabel } from './boot-failure-reauth'

type BusyAction = 'local' | 'repair' | 'retry' | 'signin' | 'update' | null

// A remote gateway whose access cookie has lapsed (e.g. the dashboard
// restarted on the remote box) boots into this overlay with a reauth-shaped
// error. The local-recovery buttons (Retry resets the local bootstrap latch;
// Repair re-runs the installer) are no-ops for that case — the only fix is to
// re-establish the remote session. The detection + copy helpers live in
// ./boot-failure-reauth so they're unit-testable without a React render.

// Recovery surface for a hard boot failure (gateway never came up, backend
// exited during startup, bootstrap latched, …). Without this the app shell
// renders dead — "gateway offline", no composer, only a toast — with no way
// to retry, repair the install, switch the gateway, or find the logs.
export function BootFailureOverlay() {
  const boot = useStore($desktopBoot)
  const onboarding = useStore($desktopOnboarding)
  const { t } = useI18n()
  const updateCheck = useStore($sidecarUpdateCheck)
  const sidecarChecking = useStore($sidecarChecking)
  const sidecarUpdating = useStore($sidecarUpdating)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [remoteReauth, setRemoteReauth] = useState<RemoteReauth | null>(null)

  const visible = Boolean(boot.error) && !boot.running
  // While first-run onboarding owns the picker/flow we let it surface its own
  // progress; the recovery overlay is for hard failures, which it covers via a
  // higher z-index regardless of onboarding state.
  const suppressed = onboarding.flow.status !== 'idle' && onboarding.flow.status !== 'error'

  useEffect(() => {
    if (!visible) {
      return
    }

    void window.nexusAgent
      ?.getRecentLogs()
      .then(res => setLogs(res.lines ?? []))
      .catch(() => undefined)
  }, [visible])

  // Resolve whether this boot failure is a remote-gateway reauth so we can
  // offer the actionable "Sign in" path instead of the local-only recovery
  // buttons. Runs whenever the overlay becomes visible.
  useEffect(() => {
    if (!visible) {
      setRemoteReauth(null)

      return
    }

    let cancelled = false

    void (async () => {
      const desktop = window.nexusAgent

      if (!desktop?.getConnectionConfig) {
        return
      }

      let config: DesktopConnectionConfig

      try {
        config = await desktop.getConnectionConfig()
      } catch {
        return
      }

      if (cancelled || !isRemoteReauthFailure(config)) {
        return
      }

      // Best-effort probe for the provider shape so the button copy matches
      // what the user will see in the login window (password form vs OAuth
      // redirect). Probe failure just keeps the generic copy.
      let shape = deriveProviderShape(null)

      try {
        const probe = await desktop.probeConnectionConfig(config.remoteUrl)
        shape = deriveProviderShape(probe?.providers)
      } catch {
        // Generic copy is fine.
      }

      if (!cancelled) {
        setRemoteReauth({ url: config.remoteUrl, ...shape })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [visible])

  // A version-skewed (outdated) gateway is a common root cause of a hard boot
  // failure, and the only fix — updating the sidecar — is unreachable while this
  // mask is up (the update button lives in Settings, behind the mask). Probe
  // once when the overlay surfaces for a local failure so the user immediately
  // sees whether an update is available. Idempotent (guarded by $sidecarChecking).
  useEffect(() => {
    if (!visible || remoteReauth) {
      return
    }

    void checkSidecarUpdate()
  }, [visible, remoteReauth])

  if (!visible || suppressed) {
    return null
  }

  const retry = async () => {
    setBusy('retry')
    // NOTE: resetBootstrap removed — just reload to retry backend resolution.
    window.location.reload()
  }

  const repair = async () => {
    setBusy('repair')
    // NOTE: repairBootstrap removed — just reload to retry backend resolution.
    window.location.reload()
  }

  const switchToLocalGateway = async () => {
    setBusy('local')
    // applyConnectionConfig reloads the window from the main process.
    await window.nexusAgent?.applyConnectionConfig({ mode: 'local' }).catch(() => undefined)
    setBusy(null)
  }

  // Download the latest sidecar, then force a respawn so the new binary
  // actually runs. The download (applySidecarUpdate) only swaps the file on
  // disk — the 500ing process keeps running and startGateway()'s latched
  // connectionPromise would just reconnect to it on a plain reload. Re-applying
  // the CURRENT connection config drives the main process to tear the process
  // down (clearing the latch) and reload, so boot respawns against the new
  // binary. Works even with the gateway HTTP dead — the update IPC goes through
  // the Electron main process directly.
  const updateAndRestartGateway = async () => {
    setBusy('update')

    try {
      const result = await applySidecarUpdate()

      if (!result.ok) {
        notify({
          kind: 'error',
          title: t.boot.failure.gatewayUpdateFailed,
          message: result.error || t.boot.failure.gatewayUpdateFailed
        })
        setBusy(null)

        return
      }

      const desktop = window.nexusAgent
      const current = await desktop?.getConnectionConfig().catch(() => null)

      if (current) {
        await desktop?.applyConnectionConfig(current).catch(() => undefined)
      } else {
        await desktop?.applyConnectionConfig({ mode: 'local' }).catch(() => undefined)
      }

      window.location.reload()
    } catch (err) {
      notifyError(err, t.boot.failure.gatewayUpdateFailed)
      setBusy(null)
    }
  }

  // Open the gateway's login window (renders the username/password form for a
  // basic gateway, or the OAuth redirect otherwise — the desktop drives both
  // through the same window). On a successful sign-in the session cookie is
  // re-established in the persistent partition; reload so boot re-runs and the
  // reconnect now mints a ticket against a live session.
  const signInRemote = async () => {
    if (!remoteReauth) {
      return
    }

    setBusy('signin')

    try {
      const result = await window.nexusAgent?.oauthLoginConnectionConfig(remoteReauth.url)

      if (result?.connected) {
        notify({ kind: 'success', title: t.boot.failure.signedInTitle, message: t.boot.failure.signedInMessage })
        window.location.reload()

        return
      }

      notify({
        kind: 'warning',
        title: t.boot.failure.signInIncompleteTitle,
        message: t.boot.failure.signInIncompleteMessage
      })
    } catch (err) {
      notifyError(err, t.boot.failure.signInFailed)
    } finally {
      setBusy(null)
    }
  }

  const openLogs = () => void window.nexusAgent?.revealLogs().catch(() => undefined)
  const copy = t.boot.failure

  const label = signInLabel(remoteReauth, {
    identityProvider: copy.identityProvider,
    remoteGateway: copy.signInToRemoteGateway,
    withProvider: copy.signInWithProvider
  })

  // Gateway-update affordance. latestVersion is nullable, so narrow it before
  // handing to the (version: string) => string copy. Label mirrors the
  // Settings gateway panel's derivation (gateway-menu-panel.tsx).
  const gatewayLatestVersion = updateCheck?.latestVersion ?? null
  const gatewayUpdateAvailable = updateCheck?.updateAvailable === true && gatewayLatestVersion !== null
  let gatewayCheckLabel = copy.gatewayCheck
  if (sidecarChecking) {
    gatewayCheckLabel = copy.gatewayChecking
  } else if (updateCheck?.error) {
    gatewayCheckLabel = copy.gatewayCheckFailed
  } else if (updateCheck && !updateCheck.updateAvailable) {
    gatewayCheckLabel = copy.gatewayUpToDate
  }

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-(--ui-chat-surface-background) p-6">
      <div className="w-full max-w-[40rem] overflow-hidden rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-chat-bubble-background) shadow-sm">
        <div className="flex items-start gap-3 border-b border-(--ui-stroke-tertiary) px-5 py-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </div>
          <div>
            <h2 className="text-[0.9375rem] font-semibold tracking-tight">
              {remoteReauth ? copy.remoteTitle : copy.title}
            </h2>
            <p className="mt-1 text-[0.8125rem] leading-5 text-(--ui-text-tertiary)">
              {remoteReauth ? copy.remoteDescription : copy.description}
            </p>
          </div>
        </div>

        <div className="grid gap-4 p-5">
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
            {boot.error}
          </div>

          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              {remoteReauth ? (
                <Button disabled={Boolean(busy)} onClick={() => void signInRemote()}>
                  {busy === 'signin' ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                  {label}
                </Button>
              ) : (
                <Button disabled={Boolean(busy)} onClick={() => void retry()}>
                  {busy === 'retry' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  {copy.retry}
                </Button>
              )}
              {!remoteReauth ? (
                <Button disabled={Boolean(busy)} onClick={() => void repair()} variant="outline">
                  {busy === 'repair' ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
                  {copy.repairInstall}
                </Button>
              ) : null}
              <Button disabled={Boolean(busy)} onClick={() => void switchToLocalGateway()} variant="outline">
                {busy === 'local' ? <Loader2 className="size-4 animate-spin" /> : null}
                {copy.useLocalGateway}
              </Button>
              <Button onClick={openLogs} variant="ghost">
                <FileText className="size-4" />
                {copy.openLogs}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {remoteReauth ? copy.remoteSignInHint : copy.repairHint}
            </p>
          </div>

          {!remoteReauth ? (
            <div className="grid gap-2 border-t border-(--ui-stroke-tertiary) pt-4">
              <p className="text-xs text-(--ui-text-tertiary)">{copy.gatewayHint}</p>
              <div className="flex flex-wrap gap-2">
                {gatewayUpdateAvailable && gatewayLatestVersion !== null && !sidecarUpdating ? (
                  <Button disabled={Boolean(busy)} onClick={() => void updateAndRestartGateway()}>
                    {busy === 'update' ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                    {busy === 'update' ? copy.gatewayUpdating : copy.gatewayUpdateTo(gatewayLatestVersion)}
                  </Button>
                ) : null}
                <Button
                  disabled={Boolean(busy) || sidecarChecking || sidecarUpdating}
                  onClick={() => void checkSidecarUpdate()}
                  variant="outline"
                >
                  {sidecarChecking || sidecarUpdating ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  {gatewayCheckLabel}
                </Button>
              </div>
            </div>
          ) : null}

          {logs.length > 0 ? (
            <div className="grid gap-2">
              <button
                className="self-start text-xs font-medium text-muted-foreground transition hover:text-foreground"
                onClick={() => setShowLogs(v => !v)}
                type="button"
              >
                {showLogs ? copy.hideRecentLogs : copy.showRecentLogs}
              </button>
              {showLogs ? (
                <pre className="max-h-48 overflow-auto rounded-2xl border border-border bg-secondary/30 p-3 font-mono text-[0.7rem] leading-4 text-muted-foreground">
                  {logs.slice(-40).join('')}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
