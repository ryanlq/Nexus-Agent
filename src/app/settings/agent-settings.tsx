import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { notifyError } from '@/store/notifications'
import { $agentAvailable, $currentProvider, setCurrentProvider } from '@/store/session'

import { CONTROL_TEXT, EMPTY_SELECT_VALUE } from './constants'
import { ListRow, LoadingState } from './primitives'

interface AgentParamDef {
  key: string
  label: string
  type: 'select' | 'text'
  options?: string[]
  default?: string
  description?: string
}

interface AgentInfo {
  slug: string
  name: string
  description: string
  installed: boolean
  install_hint?: string
  docs_url?: string
  params?: AgentParamDef[]
}

const DEFAULT_AGENTS: AgentInfo[] = [
  {
    slug: 'claude-code', name: 'Claude Code', description: "Anthropic's coding agent. Uses Claude Sonnet / Opus.", installed: false,
    install_hint: 'npm install -g @anthropic-ai/claude-code', docs_url: 'https://docs.anthropic.com/en/docs/claude-code',
    params: [{ key: 'model', label: 'Model', type: 'select', options: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'], default: 'claude-sonnet-4-6', description: 'Claude model to use.' }],
  },
  {
    slug: 'pi', name: 'Pi Agent', description: "Nous Research's Pi agent. Supports print, json, and rpc modes.", installed: false,
    install_hint: 'pip install pi-agent',
    params: [{ key: 'mode', label: 'Mode', type: 'select', options: ['print', 'json', 'rpc'], default: 'print', description: 'Pi agent communication mode.' }],
  },
  {
    slug: 'codex', name: 'OpenAI Codex', description: "OpenAI's Codex CLI coding agent.", installed: false,
    install_hint: 'npm install -g @openai/codex', docs_url: 'https://github.com/openai/codex',
    params: [{ key: 'approval_mode', label: 'Approval Mode', type: 'select', options: ['suggest', 'auto-edit', 'full-auto'], default: 'suggest', description: 'Codex approval mode for tool calls.' }],
  },
]

interface AgentSettingsProps {
  onAgentChanged?: (agent: string) => void
}

export function AgentSettings({ onAgentChanged }: AgentSettingsProps) {
  const [loading, setLoading] = useState(true)
  const [agents, setAgents] = useState<AgentInfo[]>(DEFAULT_AGENTS)
  const currentProvider = useStore($currentProvider)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')
  // Per-agent param values: { "claude-code": { model: "claude-sonnet-4-6" }, ... }
  const [paramValues, setParamValues] = useState<Record<string, Record<string, string>>>({})

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
      // Sync shared atom with server truth
      if (result.current) {
        setCurrentProvider(result.current)
      }
    } catch {
      // Fallback: get current agent from /api/model/info and use defaults
      try {
        const info = await window.hermesDesktop.api<{
          model: string
          provider: string
        }>({ path: '/api/model/info', timeoutMs: 5000 })
        setCurrentProvider(info.provider || 'claude-code')
        setAgents(DEFAULT_AGENTS)
      } catch (err) {
        setError('Could not reach agent-gateway backend. Make sure it is running.')
        setAgents(DEFAULT_AGENTS)
        setCurrentProvider('claude-code')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const switchAgent = async (slug: string) => {
    if (slug === currentProvider || switching) return
    setSwitching(true)
    const agentParams = paramValues[slug] || {}
    try {
      // Try dedicated switch endpoint first, pass params
      try {
        await window.hermesDesktop.api<{ ok: boolean }>({
          path: '/api/agents/switch',
          method: 'POST',
          body: { agent: slug, agent_params: agentParams },
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
      setCurrentProvider(slug)
      // Mark agent availability as unknown so it gets re-checked
      $agentAvailable.set(null)
      onAgentChanged?.(slug)
    } catch (err) {
      notifyError(err, 'Failed to switch agent')
    } finally {
      setSwitching(false)
    }
  }

  const setParamValue = (agentSlug: string, key: string, value: string) => {
    setParamValues(prev => ({
      ...prev,
      [agentSlug]: { ...(prev[agentSlug] || {}), [key]: value },
    }))
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
          current={agent.slug === currentProvider}
          key={agent.slug}
          onSwitch={() => void switchAgent(agent.slug)}
          paramValues={paramValues[agent.slug] || {}}
          onParamChange={(key, value) => setParamValue(agent.slug, key, value)}
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
  switching,
  paramValues,
  onParamChange,
}: {
  agent: AgentInfo
  current: boolean
  onSwitch: () => void
  switching: boolean
  paramValues: Record<string, string>
  onParamChange: (key: string, value: string) => void
}) {
  const hasParams = agent.params && agent.params.length > 0 && agent.installed

  return (
    <div className="space-y-0">
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
        description={
          agent.installed
            ? agent.description
            : agent.install_hint
              ? (
                <span>
                  {agent.description}
                  <code
                    className="ml-1.5 cursor-pointer rounded bg-muted px-1.5 py-0.5 font-mono text-[0.68rem] text-foreground transition-colors hover:bg-muted/80"
                    onClick={() => {
                      navigator.clipboard.writeText(agent.install_hint!)
                    }}
                    title="Click to copy"
                  >
                    {agent.install_hint}
                  </code>
                </span>
              )
              : agent.description
        }
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
      {hasParams && (
        <div className="ml-0 mt-0.5 grid gap-0.5 pl-0">
          {agent.params!.map(param => (
            <ListRow
              action={
                <Select
                  onValueChange={val => onParamChange(param.key, val === EMPTY_SELECT_VALUE ? '' : val)}
                  value={paramValues[param.key] || param.default || EMPTY_SELECT_VALUE}
                >
                  <SelectTrigger className={cn(CONTROL_TEXT, 'h-7 w-36')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {param.options!.map(opt => (
                      <SelectItem key={opt || EMPTY_SELECT_VALUE} value={opt || EMPTY_SELECT_VALUE}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
              description={param.description}
              key={param.key}
              title={<span className="text-xs font-normal">{param.label}</span>}
            />
          ))}
        </div>
      )}
    </div>
  )
}
