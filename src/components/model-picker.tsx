import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import type { ModelOptionProvider, ModelOptionsResponse } from '@/types/hermes'

import type { HermesGateway } from '../hermes'
import { getGlobalModelOptions } from '../hermes'
import { cn } from '../lib/utils'

import { InlineNotice } from './notifications'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Skeleton } from './ui/skeleton'

interface ModelPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  gw?: HermesGateway
  sessionId?: string | null
  currentModel: string
  currentProvider: string
  onSelect: (selection: { provider: string; model: string; persistGlobal: boolean }) => void
  /**
   * Optional class to apply to DialogContent. Use to override z-index when
   * stacking the picker on top of another fixed overlay (e.g. the desktop
   * onboarding overlay, which sits at z-1300; the default Dialog z-130 ends
   * up rendering underneath and blocks pointer events).
   */
  contentClassName?: string
}

export function ModelPickerDialog({
  open,
  onOpenChange,
  gw,
  sessionId,
  currentModel,
  currentProvider,
  onSelect,
  contentClassName
}: ModelPickerDialogProps) {
  const [persistGlobal, setPersistGlobal] = useState(!sessionId)
  // Own the search term so we can filter manually. cmdk's built-in
  // shouldFilter reorders items by its fuzzy-match score (≈alphabetical with
  // an empty query), which destroys the backend's curated order. We disable
  // it and do a plain substring filter that preserves array order — matching
  // the `hermes model` CLI picker, which shows the curated list verbatim.
  const [search, setSearch] = useState('')

  const modelOptions = useQuery({
    queryKey: ['model-options', sessionId || 'global'],
    queryFn: () => {
      if (gw && sessionId) {
        return gw.request<ModelOptionsResponse>('model.options', {
          session_id: sessionId
        })
      }

      return getGlobalModelOptions()
    },
    enabled: open
  })

  const providers = modelOptions.data?.providers ?? []
  const optionsModel = String(modelOptions.data?.model ?? currentModel ?? '')
  const optionsProvider = String(modelOptions.data?.provider ?? currentProvider ?? '')
  const loading = modelOptions.isPending && !modelOptions.data

  const error = modelOptions.error
    ? modelOptions.error instanceof Error
      ? modelOptions.error.message
      : String(modelOptions.error)
    : null

  const selectModel = (provider: ModelOptionProvider, model: string) => {
    onSelect({
      provider: provider.slug,
      model,
      persistGlobal: persistGlobal || !sessionId
    })
    onOpenChange(false)
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className={cn('max-h-[85vh] max-w-2xl gap-0 overflow-hidden p-0', contentClassName)}>
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle>Switch agent</DialogTitle>
          <DialogDescription className="font-mono text-xs leading-relaxed">
            current: {optionsProvider || currentProvider || '(unknown)'}
          </DialogDescription>
        </DialogHeader>

        <Command className="rounded-none bg-card" shouldFilter={false}>
          <CommandInput
            autoFocus
            onValueChange={setSearch}
            placeholder="Filter providers and models..."
            value={search}
          />
          <CommandList className="max-h-96">
            {!loading && !error && <CommandEmpty>No models found.</CommandEmpty>}
            <ModelResults
              currentModel={optionsModel || currentModel}
              currentProvider={optionsProvider || currentProvider}
              error={error}
              loading={loading}
              onSelectModel={selectModel}
              providers={providers}
              search={search}
            />
          </CommandList>
        </Command>

        <DialogFooter className="flex-row items-center justify-between gap-3 border-t border-border bg-card p-3 sm:justify-between">
          <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={persistGlobal || !sessionId}
              disabled={!sessionId}
              onCheckedChange={checked => setPersistGlobal(checked === true)}
            />
            {sessionId ? 'Persist globally (otherwise this session only)' : 'Persist globally'}
          </label>

          <div className="flex items-center gap-2">
            <Button onClick={() => onOpenChange(false)} variant="outline">
              Cancel
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModelResults({
  loading,
  error,
  providers,
  currentModel,
  currentProvider,
  onSelectModel,
  search
}: {
  loading: boolean
  error: string | null
  providers: ModelOptionProvider[]
  currentModel: string
  currentProvider: string
  onSelectModel: (provider: ModelOptionProvider, model: string) => void
  search: string
}) {
  if (loading) {
    return <LoadingResults />
  }

  if (error) {
    return (
      <div className="px-3 py-3">
        <InlineNotice kind="error" title="Could not load models">
          {error}
        </InlineNotice>
      </div>
    )
  }

  if (providers.length === 0) {
    return <div className="px-4 py-6 text-sm text-muted-foreground">No agents available.</div>
  }

  const q = search.trim().toLowerCase()

  // agent-gateway: each provider IS an agent. Show as flat list.
  const configured = providers.filter(p => (p.models ?? []).length > 0)
  const filtered = configured.filter(p =>
    !q || p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)
  )

  return (
    <>
      {filtered.map(provider => {
        const isCurrent = provider.slug === currentProvider
        const model = (provider.models ?? [])[0] || 'default'

        return (
          <CommandItem
            className={cn(
              'flex items-center gap-2 pl-6',
              isCurrent &&
                'bg-primary text-primary-foreground data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground',
            )}
            key={provider.slug}
            onSelect={() => onSelectModel(provider, model)}
            value={`${provider.slug}:${model}`}
          >
            <span className="min-w-0 flex-1 truncate font-medium">{provider.name}</span>
            {isCurrent && (
              <span className="shrink-0 text-[0.62rem] uppercase tracking-wide">Active</span>
            )}
            {provider.installed === false && (
              <span className="shrink-0 text-[0.62rem] uppercase tracking-wide text-muted-foreground">Not installed</span>
            )}
          </CommandItem>
        )
      })}
    </>
  )
}

function LoadingResults() {
  return (
    <CommandGroup heading={<Skeleton className="h-3 w-32" />}>
      {Array.from({ length: 4 }, (_, rowIndex) => (
        <div className="rounded-sm py-1.5 pl-6 pr-2" key={rowIndex}>
          <Skeleton className={cn('h-5', rowIndex % 3 === 0 ? 'w-3/5' : rowIndex % 3 === 1 ? 'w-4/5' : 'w-1/2')} />
        </div>
      ))}
    </CommandGroup>
  )
}
