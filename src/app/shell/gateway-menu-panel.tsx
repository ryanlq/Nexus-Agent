import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { IconLayoutDashboard } from '@tabler/icons-react'

import { StatusDot, type StatusTone } from '@/components/status-dot'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { Activity, AlertCircle, Download, Loader2, RefreshCw } from '@/lib/icons'
import type { RuntimeReadinessResult } from '@/lib/runtime-readiness'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import {
  $sidecarChecking,
  $sidecarUpdateCheck,
  $sidecarUpdating,
  $sidecarVersion,
  applySidecarUpdate,
  checkSidecarUpdate
} from '@/store/sidecar'
import type { StatusResponse } from '@/types/nexus'
import { restartGateway } from '@/nexus'

interface GatewayMenuPanelProps {
  gatewayState: string
  inferenceStatus: RuntimeReadinessResult | null
  logLines: readonly string[]
  onOpenLogs: () => void
  statusSnapshot: StatusResponse | null
}

const PLATFORM_TONE: Record<string, StatusTone> = {
  connected: 'good',
  connecting: 'warn',
  retrying: 'warn',
  pending_restart: 'warn',
  startup_failed: 'bad',
  fatal: 'bad'
}

const prettyState = (state: string) => state.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

// Strip leading "YYYY-MM-DD HH:MM:SS,mmm " and "[runtime_id] " prefixes from
// log lines so they don't dominate the display. Full text preserved on hover.
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[,.\d]*\s+/
const RUNTIME_BRACKET_RE = /^\[[^\]]+]\s+/
const trimLogLine = (raw: string) => raw.trim().replace(TIMESTAMP_RE, '').replace(RUNTIME_BRACKET_RE, '')

export function GatewayMenuPanel({
  gatewayState,
  inferenceStatus,
  logLines,
  onOpenLogs,
  statusSnapshot
}: GatewayMenuPanelProps) {
  const sidecarVersion = useStore($sidecarVersion)
  const sidecarUpdateCheck = useStore($sidecarUpdateCheck)
  const sidecarUpdating = useStore($sidecarUpdating)
  const sidecarChecking = useStore($sidecarChecking)
  const { t } = useI18n()

  const gatewayOpen = gatewayState === 'open'
  const gatewayConnecting = gatewayState === 'connecting'
  const inferenceReady = gatewayOpen && inferenceStatus?.ready === true

  const connectionLabel = gatewayOpen
    ? 'Connected'
    : gatewayConnecting
      ? 'Connecting'
      : prettyState(gatewayState || 'offline')

  const inferenceLabel = gatewayOpen
    ? inferenceStatus?.ready
      ? 'Inference ready'
      : inferenceStatus
        ? 'Inference not ready'
        : 'Checking inference'
    : 'Disconnected'

  const platforms = Object.entries(statusSnapshot?.gateway_platforms || {}).sort(([l], [r]) => l.localeCompare(r))
  const recentLogs = logLines.slice(-5)

  // Sidecar version + update state. Prefer the running gateway's self-reported
  // version (authoritative — it's what's actually executing); fall back to the
  // installed sidecar stamp, then "未知".
  const resolvedVersion = statusSnapshot?.version || sidecarVersion?.version

  const versionLabel = resolvedVersion
    ? t.gateway.version(resolvedVersion)
    : t.gateway.versionUnknown

  const updateAvailable = sidecarUpdateCheck?.updateAvailable === true
  const latestVersion = sidecarUpdateCheck?.latestVersion

  const handleCheckUpdate = () => void checkSidecarUpdate()
  const handleUpdate = () => void applySidecarUpdate()
  const [restarting, setRestarting] = useState(false)

  const handleRestart = async () => {
    setRestarting(true)
    try {
      await restartGateway()
    } catch {
      // Gateway restarts, connection may drop briefly
    }
    // Don't reset restarting — gateway will reconnect and component re-renders
  }

  useEffect(() => {
    if (gatewayState === 'open' && restarting) {
      setRestarting(false)
    }
  }, [gatewayState, restarting])

  // Pick the right label for the update button
  let updateLabel: string | null = null

  if (sidecarUpdating) {
    updateLabel = t.gateway.updating
  } else if (sidecarChecking) {
    updateLabel = t.gateway.checking
  } else if (updateAvailable && latestVersion) {
    updateLabel = t.gateway.updateAvailable(latestVersion)
  } else if (sidecarUpdateCheck && !sidecarUpdateCheck.error && !updateAvailable) {
    updateLabel = t.gateway.upToDate
  }

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {inferenceReady ? (
            <Activity className="size-3.5 text-primary" />
          ) : (
            <AlertCircle className={cn('size-3.5', gatewayOpen ? 'text-amber-600' : 'text-destructive')} />
          )}
          <span className="font-medium">Gateway</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot tone={inferenceReady ? 'good' : gatewayOpen ? 'warn' : 'bad'} />
            {inferenceLabel}
          </span>
        </div>
        <div className="flex items-center">
          <Tip label="Open logs">
            <Button
              aria-label="Open logs"
              className="text-muted-foreground hover:text-foreground"
              onClick={onOpenLogs}
              size="icon-sm"
              variant="ghost"
            >
              <IconLayoutDashboard />
            </Button>
          </Tip>
        </div>
      </div>

      <div className="border-t border-border/50 px-3 py-2 text-xs text-muted-foreground">
        <div>Connection: {connectionLabel}</div>
        {inferenceStatus?.reason && <div className="mt-1 line-clamp-3">{inferenceStatus.reason}</div>}
      </div>

      {/* Sidecar version + update */}
      <div className="flex items-center justify-between gap-2 border-t border-border/50 px-3 py-2 text-xs">
        <span className="text-muted-foreground">
          Gateway {versionLabel}
        </span>
        <div className="flex items-center gap-1">
          <Button
            className="h-6 gap-1 px-2 text-xs"
            disabled={restarting || !gatewayOpen}
            onClick={handleRestart}
            size="sm"
            variant="ghost"
          >
            <RefreshCw className={cn('size-3', restarting && 'animate-spin')} />
            {restarting ? t.gateway.restarting : t.gateway.restart}
          </Button>
          {updateAvailable && !sidecarUpdating ? (
            <Button
              className="h-6 gap-1 px-2 text-xs"
              disabled={sidecarUpdating}
              onClick={handleUpdate}
              size="sm"
              variant="secondary"
            >
              <Download className="size-3" />
              {updateLabel}
            </Button>
          ) : null}
          <Button
            className="h-6 gap-1 px-2 text-xs"
            disabled={sidecarChecking || sidecarUpdating}
            onClick={handleCheckUpdate}
            size="sm"
            variant="ghost"
          >
            {sidecarChecking || sidecarUpdating ? (
              <Loader2 className="size-3 animate-spin" />
            ) : updateAvailable ? null : (
              <Download className="size-3" />
            )}
            {!updateAvailable && (sidecarChecking ? t.gateway.checking : t.gateway.checkUpdate)}
          </Button>
        </div>
      </div>

      {sidecarUpdateCheck && !updateAvailable && (
        <div className="px-3 pb-2 text-[0.66rem] text-muted-foreground/80">
          {sidecarUpdateCheck.error ? t.gateway.checkFailed : t.gateway.upToDate}
        </div>
      )}

      {recentLogs.length > 0 && (
        <div className="border-t border-border/50 px-3 py-2">
          <SectionLabel>Recent activity</SectionLabel>
          <ul className="mt-1.5 space-y-0.5">
            {recentLogs.map((line, index) => (
              <Tip key={`${index}:${line}`} label={line.trim()}>
                <li className="truncate font-mono text-[0.68rem] text-muted-foreground/85">
                  {trimLogLine(line) || ' '}
                </li>
              </Tip>
            ))}
          </ul>
          <button
            className="mt-1.5 text-[0.66rem] font-medium text-muted-foreground hover:text-foreground"
            onClick={onOpenLogs}
            type="button"
          >
            View all logs →
          </button>
        </div>
      )}

      {platforms.length > 0 && (
        <div className="border-t border-border/50 px-3 py-2">
          <SectionLabel>Messaging platforms</SectionLabel>
          <ul className="mt-1.5 space-y-1">
            {platforms.map(([name, platform]) => (
              <li className="flex items-center justify-between gap-2 text-xs" key={name}>
                <span className="truncate capitalize">{name}</span>
                <span className="flex items-center gap-1.5 text-[0.66rem] text-muted-foreground">
                  <StatusDot tone={PLATFORM_TONE[platform.state] || 'muted'} />
                  {prettyState(platform.state)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">{children}</div>
  )
}
