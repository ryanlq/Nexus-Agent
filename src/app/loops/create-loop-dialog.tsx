import type * as React from 'react'
import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createCronJob } from '@/nexus'
import { useI18n } from '@/i18n'
import { notify, notifyError } from '@/store/notifications'

import { $createLoop, bumpLoopsNonce, closeCreateLoopDialog } from './create-loop-store'

/**
 * Force a bare duration to RECURRING so /loop-style intervals always loop.
 * Mirrors the gateway's core/commands.normalize_loop_schedule: `10m` -> `every 10m`.
 */
function normalizeLoopSchedule(interval: string): string {
  const s = interval.trim()
  if (!s) {
    return s
  }
  if (s.toLowerCase().startsWith('every ')) {
    return s
  }
  // 5+ cron-style fields -> cron expr, already recurring
  const parts = s.split(/\s+/)
  if (parts.length >= 5 && parts.slice(0, 5).every(p => /^[\d*/,-]+$/.test(p))) {
    return s
  }
  if (/^\d+[smhd]$/i.test(s)) {
    return `every ${s.toLowerCase()}`
  }
  return s
}

/**
 * Singleton loop-creation dialog. Rendered once at the controller level; opened
 * by either the Loops panel's "New loop" button or the `/loop` composer command
 * (which pre-fills any typed args). On success it bumps $loopsNonce so an open
 * Loops panel reloads, then closes.
 */
export function CreateLoopDialog(): React.ReactElement {
  const { t } = useI18n()
  const l = t.loops
  const state = useStore($createLoop)
  const open = state.open

  const [interval, setInterval] = useState('10m')
  const [prompt, setPrompt] = useState('')
  const [name, setName] = useState('')
  const [maxRuns, setMaxRuns] = useState('')
  const [stopCondition, setStopCondition] = useState('')
  const [saving, setSaving] = useState(false)

  // Seed the form from the prefill every time the dialog opens. Deps are the
  // scalar fields, so in-dialog typing (local state) never re-triggers this.
  useEffect(() => {
    if (!open) {
      return
    }
    setInterval(state.prefill.interval)
    setPrompt(state.prefill.prompt)
    setName('')
    setMaxRuns('')
    setStopCondition('')
  }, [open, state.prefill.interval, state.prefill.prompt])

  const submit = async (): Promise<void> => {
    const schedule = normalizeLoopSchedule(interval)
    if (!schedule || !prompt.trim()) {
      return
    }
    const parsedMax = maxRuns.trim() ? Number.parseInt(maxRuns.trim(), 10) : NaN
    const maxRunsPayload =
      Number.isFinite(parsedMax) && parsedMax >= 1 ? parsedMax : undefined
    setSaving(true)
    try {
      await createCronJob({
        schedule,
        prompt: prompt.trim(),
        name: name.trim() || undefined,
        deliver: 'local',
        max_runs: maxRunsPayload,
        stop_condition: stopCondition.trim() || undefined
      })
      notify({ kind: 'success', message: l.created })
      bumpLoopsNonce()
      closeCreateLoopDialog()
    } catch (err) {
      notifyError(err, l.failedCreate)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      onOpenChange={next => {
        if (!next) {
          closeCreateLoopDialog()
        }
      }}
      open={open}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{l.newLoop}</DialogTitle>
          <DialogDescription>{l.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{l.interval}</span>
            <Input onChange={e => setInterval(e.target.value)} placeholder="10m" value={interval} />
            <span className="text-[0.7rem] text-muted-foreground">{l.intervalHint}</span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{l.task}</span>
            <Textarea
              onChange={e => setPrompt(e.target.value)}
              placeholder={l.taskPlaceholder}
              rows={4}
              value={prompt}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{l.name}</span>
            <Input onChange={e => setName(e.target.value)} placeholder={l.namePlaceholder} value={name} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{l.maxRuns}</span>
            <Input
              onChange={e => setMaxRuns(e.target.value)}
              placeholder={l.maxRunsPlaceholder}
              value={maxRuns}
              inputMode="numeric"
            />
            <span className="text-[0.7rem] text-muted-foreground">{l.maxRunsHint}</span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{l.stopCondition}</span>
            <Input
              onChange={e => setStopCondition(e.target.value)}
              placeholder={l.stopConditionPlaceholder}
              value={stopCondition}
            />
            <span className="text-[0.7rem] text-muted-foreground">{l.stopConditionHint}</span>
          </label>
        </div>
        <DialogFooter>
          <Button onClick={() => closeCreateLoopDialog()} variant="ghost">{l.cancel}</Button>
          <Button
            disabled={saving || !interval.trim() || !prompt.trim()}
            onClick={() => void submit()}
          >
            {saving ? l.creating : l.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
