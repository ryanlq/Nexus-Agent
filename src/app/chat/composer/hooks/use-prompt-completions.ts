import type { Unstable_TriggerAdapter, Unstable_TriggerItem } from '@assistant-ui/core'
import { useCallback } from 'react'

import { type CustomPrompt, listPrompts } from '@/nexus'

import type { CompletionEntry, CompletionPayload } from './use-live-completion-adapter'
import { useLiveCompletionAdapter } from './use-live-completion-adapter'

const PREFIX = 'prompt:'

interface PromptItemMetadata extends Record<string, string> {
  icon: string
  display: string
  meta: string
  /** Raw chip text, e.g. `@prompt:code-review`. */
  rawText: string
  /** Just the prompt name (after `@prompt:`). */
  insertId: string
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()

  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

/**
 * Live `@prompt:` completions backed by the gateway's custom-prompts library
 * (REST `/api/prompts`). Unlike `useAtCompletions`, this does NOT call the
 * gateway's `complete.path` RPC — the prompt list is resolved locally and
 * filtered by name. Selecting an item inserts an `@prompt:<name>` chip that
 * `submitPromptText` turns into a `system_prompt` field.
 */
export function usePromptCompletions(): { adapter: Unstable_TriggerAdapter; loading: boolean } {
  const enabled = true

  const fetcher = useCallback(async (query: string): Promise<CompletionPayload> => {
    const nameQuery = query.startsWith(PREFIX) ? query.slice(PREFIX.length).toLowerCase() : ''

    let prompts: CustomPrompt[] = []

    try {
      prompts = await listPrompts()
    } catch {
      prompts = []
    }

    const filtered = prompts.filter(p => !nameQuery || p.name.toLowerCase().includes(nameQuery))

    const items: CompletionEntry[] = filtered.map(p => ({
      text: `@prompt:${p.name}`,
      display: p.name,
      meta: p.content ? truncate(p.content, 60) : 'Custom prompt'
    }))

    return { items, query }
  }, [])

  const toItem = useCallback((entry: CompletionEntry, index: number): Unstable_TriggerItem => {
    const name = entry.text.slice(`@${PREFIX}`.length)
    const display = typeof entry.display === 'string' ? entry.display : name
    const meta = typeof entry.meta === 'string' ? entry.meta : ''

    const metadata: PromptItemMetadata = {
      icon: 'prompt',
      display,
      meta,
      rawText: entry.text,
      insertId: name
    }

    return {
      id: `${entry.text}|${index}`,
      type: 'prompt',
      label: display,
      ...(meta ? { description: meta } : {}),
      metadata
    }
  }, [])

  return useLiveCompletionAdapter({ enabled, fetcher, toItem })
}
