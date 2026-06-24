import type * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@nanostores/react'

import { PageLoader } from '@/components/page-loader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  type CronJob,
  type CronJobOutput,
  deleteCronJob,
  getCronJobOutput,
  getCronJobs,
  pauseCronJob,
  resumeCronJob,
  triggerCronJob
} from '@/nexus'
import { useI18n } from '@/i18n'
import { Clock } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { notifyError } from '@/store/notifications'

import { useRefreshHotkey } from '../hooks/use-refresh-hotkey'
import { PageSearchShell } from '../page-search-shell'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'
import { $loopsNonce, openCreateLoopDialog } from './create-loop-store'

// A loop is a RECURRING cron job. One-shots (kind "once") are scheduled tasks,
// not loops, so they are filtered out.
const isLoop = (job: CronJob): boolean => {
  const kind = typeof job.schedule?.kind === 'string' ? job.schedule.kind : ''
  return kind === 'interval' || kind === 'cron'
}

const STATE_TONE: Record<string, 'good' | 'muted' | 'warn' | 'bad'> = {
  enabled: 'good',
  scheduled: 'good',
  running: 'good',
  paused: 'warn',
  disabled: 'muted',
  error: 'bad',
  completed: 'muted'
}

const PILL_TONE: Record<'good' | 'muted' | 'warn' | 'bad', string> = {
  good: 'bg-primary/10 text-primary',
  muted: 'bg-muted text-muted-foreground',
  warn: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
  bad: 'bg-destructive/10 text-destructive'
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

const truncate = (value: string, max = 80): string => (value.length > max ? `${value.slice(0, max)}…` : value)

function loopTitle(job: CronJob): string {
  const name = asText(job.name).trim()
  if (name) {
    return name
  }
  const prompt = asText(job.prompt)
  if (prompt) {
    return truncate(prompt, 60)
  }
  return job.id || 'loop'
}

function loopSchedule(job: CronJob): string {
  return asText(job.schedule_display) || asText(job.schedule?.display) || asText(job.schedule?.expr) || '—'
}

function loopState(job: CronJob): string {
  return asText(job.state) || (job.enabled === false ? 'disabled' : 'scheduled')
}

function formatTime(iso: null | string | undefined): string {
  if (!iso) {
    return '—'
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  return date.toLocaleString()
}

// Routed main-pane page (same shell as Skills/Prompts/Messaging), not an
// overlay. The create form lives in the shared CreateLoopDialog (opened from
// here or the `/loop` composer command); this view lists loops and their output.
export interface LoopsViewProps extends React.ComponentProps<'section'> {
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

export function LoopsView({
  setStatusbarItemGroup: _setStatusbarItemGroup,
  ...props
}: LoopsViewProps): React.ReactElement {
  const { t } = useI18n()
  const l = t.loops

  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<null | string>(null)
  const [query, setQuery] = useState('')

  // Output viewer
  const [selected, setSelected] = useState<null | CronJob>(null)
  const [outputs, setOutputs] = useState<CronJobOutput[]>([])
  const [outputLoading, setOutputLoading] = useState(false)

  // Reload when a loop is created elsewhere (the shared CreateLoopDialog, opened
  // from either this panel's button or the `/loop` composer command).
  const nonce = useStore($loopsNonce)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const all = await getCronJobs()
      setJobs(all.filter(isLoop))
    } catch (err) {
      notifyError(err, l.failedLoad)
    } finally {
      setLoading(false)
    }
  }, [l.failedLoad])

  useRefreshHotkey(load)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (nonce > 0) {
      void load()
    }
  }, [nonce, load])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return jobs
    }
    return jobs.filter(
      job => loopTitle(job).toLowerCase().includes(q) || asText(job.prompt).toLowerCase().includes(q)
    )
  }, [jobs, query])

  const openOutput = useCallback(
    async (job: CronJob) => {
      setSelected(job)
      setOutputs([])
      setOutputLoading(true)
      try {
        setOutputs(await getCronJobOutput(job.id))
      } catch (err) {
        notifyError(err, l.failedLoadOutput)
      } finally {
        setOutputLoading(false)
      }
    },
    [l.failedLoadOutput]
  )

  const togglePause = useCallback(
    async (job: CronJob) => {
      setBusyId(job.id)
      try {
        const isPaused = loopState(job) === 'paused' || job.enabled === false
        const updated = isPaused ? await resumeCronJob(job.id) : await pauseCronJob(job.id)
        setJobs(current => (current ? current.map(row => (row.id === job.id ? updated : row)) : current))
      } finally {
        setBusyId(null)
      }
    },
    []
  )

  const trigger = useCallback(
    async (job: CronJob) => {
      setBusyId(job.id)
      try {
        const updated = await triggerCronJob(job.id)
        setJobs(current => (current ? current.map(row => (row.id === job.id ? updated : row)) : current))
      } finally {
        setBusyId(null)
      }
    },
    []
  )

  const remove = useCallback(
    async (job: CronJob) => {
      setBusyId(job.id)
      try {
        await deleteCronJob(job.id)
        setJobs(current => (current ? current.filter(row => row.id !== job.id) : current))
        if (selected?.id === job.id) {
          setSelected(null)
        }
      } finally {
        setBusyId(null)
      }
    },
    [selected]
  )

  return (
    <PageSearchShell
      {...props}
      onSearchChange={setQuery}
      searchHidden={jobs.length === 0}
      searchPlaceholder={l.search}
      searchTrailingAction={
        <>
          <Button
            aria-label={l.refresh}
            className="text-(--ui-text-tertiary) hover:bg-transparent hover:text-foreground"
            disabled={loading}
            onClick={() => void load()}
            size="icon-xs"
            title={l.refresh}
            type="button"
            variant="ghost"
          >
            <Codicon name="refresh" size="0.875rem" />
          </Button>
          <Button
            aria-label={l.newLoop}
            className="text-(--ui-text-tertiary) hover:bg-transparent hover:text-foreground"
            onClick={() => openCreateLoopDialog()}
            size="icon-xs"
            title={l.newLoop}
            type="button"
            variant="ghost"
          >
            <Codicon name="add" size="0.875rem" />
          </Button>
        </>
      }
      searchValue={query}
    >
      {loading ? (
        <PageLoader label={t.cron.loading} />
      ) : visible.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center px-3 text-center">
          <p className="text-sm font-medium">{l.emptyTitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{l.emptyDesc}</p>
        </div>
      ) : (
        <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-(--ui-stroke-quaternary)">
          {/* List */}
          <div className="min-h-0 overflow-y-auto px-2 py-2">
            <ul className="flex flex-col gap-1">
              {visible.map(job => {
                const tone = STATE_TONE[loopState(job)] ?? 'muted'
                const isSelected = selected?.id === job.id
                return (
                  <li key={job.id}>
                    {/* Card wrapper. The clickable region is its own <button>
                        with NO nested buttons; pause/trigger/delete are siblings
                        below it. Nesting <button> in <button> is invalid HTML
                        and breaks click handling on the inner buttons. */}
                    <div
                      className={cn(
                        'flex flex-col gap-1.5 rounded-md border border-transparent transition-colors hover:bg-(--ui-control-hover-background)',
                        isSelected && 'border-(--ui-stroke-tertiary) bg-(--ui-control-active-background)'
                      )}
                    >
                      <button
                        className="flex w-full flex-col gap-1.5 px-3 pt-2 text-left"
                        onClick={() => void openOutput(job)}
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{loopTitle(job)}</span>
                          <span className={cn('rounded px-1.5 py-0.5 text-[0.65rem] font-medium', PILL_TONE[tone])}>
                            {t.cron.states[loopState(job)] ?? loopState(job)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[0.7rem] text-muted-foreground">
                          <span className="font-mono">{loopSchedule(job)}</span>
                          <span>·</span>
                          <span>{l.next}: {formatTime(job.next_run_at)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
                          <span>{l.iterations(job.completed ?? 0, job.max_runs ?? null)}</span>
                          {job.stop_condition && (
                            <span
                              className="max-w-[12rem] truncate rounded bg-(--ui-control-hover-background) px-1 py-0.5"
                              title={job.stop_condition}
                            >
                              {l.stopConditionBadge}
                            </span>
                          )}
                        </div>
                      </button>
                      <div className="flex items-center gap-1 px-3 pb-2 pt-0.5">
                        <Button
                          disabled={busyId === job.id}
                          onClick={() => void togglePause(job)}
                          size="sm"
                          variant="ghost"
                        >
                          {loopState(job) === 'paused' || job.enabled === false ? l.resume : l.pause}
                        </Button>
                        <Button
                          disabled={busyId === job.id}
                          onClick={() => void trigger(job)}
                          size="sm"
                          variant="ghost"
                        >
                          {l.trigger}
                        </Button>
                        <Button
                          disabled={busyId === job.id}
                          onClick={() => void remove(job)}
                          size="sm"
                          variant="ghost"
                        >
                          {l.delete}
                        </Button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Output viewer */}
          <div className="min-h-0 overflow-y-auto px-4 py-3">
            {!selected ? (
              <div className="py-10 text-center text-sm text-muted-foreground">{l.viewOutput}</div>
            ) : outputLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">{l.loadingOutput}</div>
            ) : outputs.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm font-medium">{loopTitle(selected)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{l.noOutput}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{l.outputOf(loopTitle(selected))}</h3>
                  <Badge variant="muted">{l.runs(outputs.length)}</Badge>
                </div>
                {outputs.map(out => (
                  <div key={out.run_at} className="rounded-md border bg-(--ui-sidebar-surface-background) p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
                      <Clock className="size-3" />
                      <span className="font-mono">{out.run_at}</span>
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-[0.72rem] leading-relaxed">
                      {out.content}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </PageSearchShell>
  )
}
