import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { notifyError } from '@/store/notifications'

import { CONTROL_TEXT } from './constants'
import { ListRow, LoadingState } from './primitives'

interface AgentInfo {
  slug: string
  name: string
  description: string
  installed: boolean
}

const DEFAULT_AGENTS: AgentInfo[] = [
  { slug: 'claude-code', name: 'Claude Code', description: "Anthropic's coding agent. Uses Claude Sonnet / Opus.", installed: false },
  { slug: 'pi', name: 'Pi Agent', description: "Nous Research's Pi agent. Supports print, json, and rpc modes.", installed: false },
  { slug: 'codex', name: 'OpenAI Codex', description: "OpenAI's Codex CLI coding agent.", installed: false },
]

interface AgentSettingsProps {
  onAgentChanged?: (agent: string) => void
}

export function AgentSettings({ onAgentChanged }: AgentSettingsProps) {
  const [loading, setLoading] = useState(true)
  const [agents, setAgents] = useState<AgentInfo[]>(DEFAULT_AGENTS)
  const [current, setCurrent] = useState('')
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      // Try the dedicated agent-status endpoint first (short timeout)
      const result = await window.hermesDesktop.api<{
        agents: AgentInfo[]
        current: string
      }>({ path: '/api/agents/status', timeoutMs: 5000 })
      setAgents(result.agents || DEFAULT_AGENTS)
      setCurrent(result.current || '')
    } catch {
      // Fallback: get current agent from /api/model/info and use defaults
      try {
        const info = await window.hermesDesktop.api<{
          model: string
          provider: string
        }>({ path: '/api/model/info', timeoutMs: 5000 })
        setCurrent(info.provider || 'claude-code')
        setAgents(DEFAULT_AGENTS)
      } catch (err) {
        setError('Could not reach agent-gateway backend. Make sure it is running.')
        setAgents(DEFAULT_AGENTS)
        setCurrent('claude-code')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const switchAgent = async (slug: string) => {
    if (slug === current || switching) return
    setSwitching(true)
    try {
      // Try dedicated switch endpoint first
      try {
        await window.hermesDesktop.api<{ ok: boolean }>({
          path: '/api/agents/switch',
          method: 'POST',
          body: { agent: slug },
          timeoutMs: 5000,
        })
      } catch {
        // Fallback to model/set
        await window.hermesDesktop.api<{ ok: boolean }>({
          path: '/api/model/set',
          method: 'POST',
          body: { provider: slug, model: 'default', scope: 'main' },
          timeoutMs: 5000,
        })
      }
      setCurrent(slug)
      onAgentChanged?.(slug)
    } catch (err) {
      notifyError(err, 'Failed to switch agent')
    } finally {
      setSwitching(false)
    }
  }

  if (loading) {
    return <LoadingState label="Detecting installed agents..." />
  }

  return (
    <div className="grid gap-1">
      <p className="mb-3 text-xs text-muted-foreground">
        Select the AI agent for new sessions. Each agent is a locally installed CLI tool.
      </p>
      {error && (
        <div className="mb-3 rounded-md border border-destructive/35 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {agents.map(agent => (
        <AgentRow
          agent={agent}
          current={agent.slug === current}
          key={agent.slug}
          onSwitch={() => void switchAgent(agent.slug)}
          switching={switching}
        />
      ))}
    </div>
  )
}

function AgentRow({
  agent,
  current,
  onSwitch,
  switching
}: {
  agent: AgentInfo
  current: boolean
  onSwitch: () => void
  switching: boolean
}) {
  return (
    <ListRow
      action={
        <div className="flex items-center gap-2">
          {agent.installed ? (
            <Button
              className={cn(CONTROL_TEXT)}
              disabled={current || switching}
              onClick={onSwitch}
              size="sm"
              variant={current ? 'outline' : 'default'}
            >
              {current ? 'Active' : switching ? 'Switching...' : 'Select'}
            </Button>
          ) : (
            <span className={cn(CONTROL_TEXT, 'text-muted-foreground')}>
              Not installed
            </span>
          )}
        </div>
      }
      description={agent.description}
      title={
        <span className="flex items-center gap-2">
          {agent.name}
          <span className={cn(
            'inline-flex items-center rounded-sm px-1.5 py-0.5 text-[0.62rem] font-medium uppercase tracking-wide',
            agent.installed
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : 'bg-muted text-muted-foreground'
          )}>
            {agent.installed ? 'Installed' : 'Missing'}
          </span>
          {current && (
            <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-primary">
              Active
            </span>
          )}
        </span>
      }
    />
  )
}
