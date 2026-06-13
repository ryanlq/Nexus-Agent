import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { type Translations, useI18n } from '@/i18n'
import { Download, ExternalLink, RefreshCw, Sparkles } from '@/lib/icons'
import {
  $desktopVersion,
  refreshDesktopVersion
} from '@/store/version'
import {
  $desktopUpdateStatus,
  applyDesktopUpdate,
  checkDesktopUpdate,
  downloadDesktopUpdate
} from '@/store/desktop-updates'

import { ListRow, SettingsContent } from './primitives'

const PROJECT_URL = 'https://github.com/ryanlq/Nexus-Agent'

function relativeTime(ms: number | undefined, a: Translations['settings']['about']) {
  if (!ms) {
    return a.never
  }

  const diff = Date.now() - ms

  if (diff < 60_000) {
    return a.justNow
  }

  if (diff < 3_600_000) {
    return a.minAgo(Math.round(diff / 60_000))
  }

  if (diff < 86_400_000) {
    return a.hoursAgo(Math.round(diff / 3_600_000))
  }

  return a.daysAgo(Math.round(diff / 86_400_000))
}

export function AboutSettings() {
  const { t } = useI18n()
  const a = t.settings.about
  const version = useStore($desktopVersion)
  const updateStatus = useStore($desktopUpdateStatus)

  useEffect(() => {
    void refreshDesktopVersion()
  }, [])

  const { stage, error, percent, info } = updateStatus

  function statusText(): string {
    switch (stage) {
      case 'checking':
        return a.checking
      case 'available':
        return info?.version
          ? `v${info.version} ${a.seeWhatsNew}`
          : a.tapCheck
      case 'downloading':
        return `${a.checking} ${Math.round(percent)}%`
      case 'downloaded':
        return info?.version
          ? `v${info.version} — ${a.onLatest.replace('You\'re on the latest version.', '').trim() || a.seeWhatsNew}`
          : a.seeWhatsNew
      case 'error':
        if (error === 'dev-mode' || error === 'updater-unavailable') {
          return a.cantUpdate
        }
        return a.cantReach
      default:
        return a.tapCheck
    }
  }

  return (
    <SettingsContent>
      <div className="flex flex-col items-center gap-3 pt-6 pb-2 text-center">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Sparkles className="size-8" />
        </span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Nexus Agent + Agent Gateway</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {version?.appVersion
              ? `Desktop v${version.appVersion} · Electron ${version.electronVersion}`
              : a.versionUnavailable}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {version?.platform ?? ''} · Node {version?.nodeVersion ?? ''}
          </p>
        </div>
      </div>

      <div className="mx-auto mt-4 w-full max-w-2xl">
        {/* ── Updates section ── */}
        <div className="rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-chat-bubble-background) p-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">{a.updates}</div>
            {(stage === 'idle' || stage === 'error') && error !== 'updater-unavailable' && error !== 'dev-mode' && (
              <Button
                className="gap-1.5"
                onClick={() => void checkDesktopUpdate()}
                size="xs"
                variant="ghost"
              >
                <RefreshCw className="size-3.5" />
                {a.checkNow}
              </Button>
            )}
          </div>

          <p className="mt-1.5 text-xs text-muted-foreground">{statusText()}</p>

          {/* Progress bar */}
          {stage === 'downloading' && (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-(--ui-bg-quinary)">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
              />
            </div>
          )}

          {/* Action buttons */}
          {stage === 'available' && (
            <Button
              className="mt-3 gap-1.5"
              onClick={() => void downloadDesktopUpdate()}
              size="sm"
              variant="default"
            >
              <Download className="size-3.5" />
              {t.notifications.downloadUpdate}
            </Button>
          )}
          {stage === 'downloaded' && (
            <Button
              className="mt-3 gap-1.5"
              onClick={() => void applyDesktopUpdate()}
              size="sm"
              variant="default"
            >
              <RefreshCw className="size-3.5" />
              {t.notifications.restartToUpdate}
            </Button>
          )}
        </div>

        <ListRow
          description="This desktop app connects to a local agent-gateway server, which wraps installed CLI agents (Claude Code, Pi, Codex) into a unified chat interface."
          title="Agent Gateway Integration"
        />

        <ListRow
          action={
            <a
              href={PROJECT_URL}
              onClick={event => {
                event.preventDefault()
                void window.nexusAgent?.openExternal?.(PROJECT_URL)
              }}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink className="size-3.5 text-muted-foreground hover:text-foreground" />
            </a>
          }
          description="Powered by agent-gateway with Claude Code, Pi, and Codex bridges."
          title="Open Source"
        />
      </div>
    </SettingsContent>
  )
}
