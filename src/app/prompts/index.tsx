import type * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { createPrompt, deletePrompt, listPrompts, updatePrompt } from '@/nexus'
import type { CustomPrompt } from '@/nexus'
import { notify, notifyError } from '@/store/notifications'

import { useRefreshHotkey } from '../hooks/use-refresh-hotkey'
import { PageSearchShell } from '../page-search-shell'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

interface EditingPrompt {
  /** Original name when editing an existing prompt; undefined when creating. */
  original?: string
  name: string
  content: string
}

interface PromptsViewProps extends React.ComponentProps<'section'> {
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

export function PromptsView({ setStatusbarItemGroup: _setStatusbarItemGroup, ...props }: PromptsViewProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [prompts, setPrompts] = useState<CustomPrompt[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [editing, setEditing] = useState<EditingPrompt | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)

    try {
      setPrompts(await listPrompts())
    } catch (err) {
      notifyError(err, t.prompts.loadFailed)
    } finally {
      setRefreshing(false)
    }
  }, [t])

  useRefreshHotkey(refresh)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = prompts ?? []

    return q ? list.filter(p => p.name.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)) : list
  }, [prompts, query])

  async function handleSave() {
    if (!editing) {
      return
    }

    const name = editing.name.trim()
    const content = editing.content

    if (!name) {
      notify({ kind: 'error', title: t.prompts.nameRequired, message: t.prompts.name })

      return
    }

    setSaving(true)

    try {
      const renamed = editing.original && editing.original !== name

      if (editing.original && !renamed) {
        await updatePrompt(name, content)
      } else {
        // New prompt, or a rename (create under the new name, then drop the old).
        const result = await createPrompt(name, content)

        if (result.ok === false) {
          notify({ kind: 'error', title: result.error ?? t.prompts.failedToSave, message: result.error ?? t.prompts.failedToSave })

          return
        }

        if (renamed && editing.original) {
          await deletePrompt(editing.original).catch(() => undefined)
        }
      }

      notify({ kind: 'success', title: editing.original ? t.prompts.updated : t.prompts.created, message: editing.name })
      setEditing(null)
      await refresh()
    } catch (err) {
      notifyError(err, t.prompts.failedToSave)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(name: string) {
    setSaving(true)

    try {
      const result = await deletePrompt(name)

      if (result.ok === false) {
        notify({ kind: 'error', title: result.error ?? t.prompts.failedToDelete, message: result.error ?? t.prompts.failedToDelete })

        return
      }

      notify({ kind: 'success', title: t.prompts.deleted, message: name })
      await refresh()
    } catch (err) {
      notifyError(err, t.prompts.failedToDelete)
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageSearchShell
      {...props}
      onSearchChange={setQuery}
      searchHidden={(prompts?.length ?? 0) === 0 || !!editing}
      searchPlaceholder={t.prompts.search}
      searchTrailingAction={
        <Button
          aria-label={t.prompts.create}
          className="text-(--ui-text-tertiary) hover:bg-transparent hover:text-foreground"
          disabled={refreshing}
          onClick={() => setEditing({ name: '', content: '' })}
          size="icon-xs"
          title={t.prompts.create}
          type="button"
          variant="ghost"
        >
          <Codicon name="add" size="0.875rem" />
        </Button>
      }
      searchValue={query}
    >
      {editing ? (
        <div className="h-full overflow-y-auto px-4 py-3">
          <div className="mx-auto max-w-2xl space-y-3">
            <div className="text-sm font-medium">{editing.original ? t.prompts.edit : t.prompts.create}</div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">{t.prompts.name}</label>
              <Input
                onChange={event => setEditing(current => (current ? { ...current, name: event.target.value } : current))}
                placeholder={t.prompts.namePlaceholder}
                value={editing.name}
              />
              <p className="font-mono text-[0.65rem] text-(--ui-text-tertiary)">@prompt:{editing.name || 'name'}</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">{t.prompts.content}</label>
              <Textarea
                className="font-mono text-xs"
                onChange={event =>
                  setEditing(current => (current ? { ...current, content: event.target.value } : current))
                }
                placeholder={t.prompts.contentPlaceholder}
                rows={10}
                value={editing.content}
              />
            </div>

            <p className="text-xs text-muted-foreground">{t.prompts.hint}</p>

            <div className="flex justify-end gap-2">
              <Button disabled={saving} onClick={() => setEditing(null)} variant="ghost">
                {t.prompts.cancel}
              </Button>
              <Button disabled={saving} onClick={() => void handleSave()}>
                {t.prompts.save}
              </Button>
            </div>
          </div>
        </div>
      ) : !prompts ? (
        <PageLoader label={t.prompts.loading} />
      ) : visible.length === 0 ? (
        <EmptyState
          actionLabel={t.prompts.createFirst}
          description={t.prompts.emptyDesc}
          onAction={() => setEditing({ name: '', content: '' })}
          title={t.prompts.emptyTitle}
        />
      ) : (
        <div className="h-full overflow-y-auto px-4 py-3">
          <div className="divide-y divide-(--ui-stroke-quaternary)">
            {visible.map(prompt => (
              <div className="grid gap-3 px-0 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={prompt.name}>
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm font-medium">@prompt:{prompt.name}</div>
                  <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                    {prompt.content || t.prompts.noBody}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {confirmingDelete === prompt.name ? (
                    <>
                      <Button
                        disabled={saving}
                        onClick={() => {
                          void handleDelete(prompt.name)
                          setConfirmingDelete(null)
                        }}
                        size="sm"
                        variant="destructive"
                      >
                        {t.prompts.confirmDelete}
                      </Button>
                      <Button onClick={() => setConfirmingDelete(null)} size="sm" variant="ghost">
                        {t.prompts.cancel}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        aria-label={t.prompts.edit}
                        onClick={() => setEditing({ original: prompt.name, name: prompt.name, content: prompt.content })}
                        size="icon-xs"
                        title={t.prompts.edit}
                        variant="ghost"
                      >
                        <Codicon name="edit" size="0.875rem" />
                      </Button>
                      <Button
                        aria-label={t.prompts.delete}
                        disabled={saving}
                        onClick={() => setConfirmingDelete(prompt.name)}
                        size="icon-xs"
                        title={t.prompts.delete}
                        variant="ghost"
                      >
                        <Codicon name="trash" size="0.875rem" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageSearchShell>
  )
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction
}: {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="grid min-h-52 place-items-center px-6 py-12 text-center">
      <div className="max-w-sm space-y-2">
        <div className="text-sm font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
        {actionLabel && onAction && (
          <Button className="mt-2" onClick={onAction} size="sm">
            <Codicon name="add" />
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  )
}
