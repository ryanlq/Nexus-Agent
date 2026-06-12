import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { type Translations, useI18n } from '@/i18n'
import { ExternalLink, Sparkles } from '@/lib/icons'
import {
  $desktopVersion,
  refreshDesktopVersion
} from '@/store/version'

import { ListRow, SettingsContent } from './primitives'

const PROJECT_URL = 'https://github.com/NousResearch/hermes-agent'

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

  useEffect(() => {
    void refreshDesktopVersion()
  }, [])

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
        <ListRow
          description='This desktop app connects to a local agent-gateway server, which wraps installed CLI agents (Claude Code, Pi, Codex) into a unified chat interface.'
          title='Agent Gateway Integration'
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
          description='Powered by agent-gateway with Claude Code, Pi, and Codex bridges.'
          title='Open Source'
        />
      </div>
    </SettingsContent>
  )
}
