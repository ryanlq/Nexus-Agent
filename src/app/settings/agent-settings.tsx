import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { notifyError } from '@/store/notifications'
import { $agentAvailable, $currentProvider, setCurrentProvider } from '@/store/session'

import { CONTROL_TEXT, EMPTY_SELECT_VALUE } from './constants'
import { ListRow, LoadingState } from './primitives'

interface AgentParamDef {
  key: string
  label: string
  type: 'select' | 'text' | 'toggle' | 'number'
  options?: string[]
  default?: string
  min?: number
  max?: number
  description?: string
  // When true the number field gets an "Unlimited" toggle. Unlimited is
  // encoded as an empty string, which the gateway coerces to None —
  // timeout=None means no deadline, max_turns=None means run to completion.
  allowUnlimited?: boolean
}

// Read a param's current value, falling back to its default ONLY when the key
// is absent (not when it's the empty "unlimited" sentinel).
const paramField = (values: Record<string, string>, param: AgentParamDef): string =>
  param.key in values ? values[param.key] : (param.default ?? '')

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
    slug: 'claude-code-sdk', name: 'Claude Code (SDK)', description: "Anthropic's coding agent via the official Python SDK. Structured events, native session resume.", installed: false,
    install_hint: 'pip install claude-code-sdk && npm install -g @anthropic-ai/claude-code', docs_url: 'https://docs.anthropic.com/en/docs/claude-code',
    params: [
      { key: 'model', label: 'Model', type: 'select', options: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'], default: 'claude-sonnet-4-6', description: 'Claude model to use.' },
      { key: 'bare', label: 'Bare Mode', type: 'toggle', default: 'false', description: '极简模式：跳过工具、技能、上下文加载，节省 token。适合简单问答。' },
      { key: 'max_turns', label: 'Max Turns', type: 'number', default: '20', min: 1, allowUnlimited: true, description: '最大 agentic 轮数。1=纯对话无工具，5-10=允许读文件/搜索等，更高=复杂任务。开启 Unlimited=跑到自然结束。' },
      { key: 'timeout', label: 'Timeout (s)', type: 'number', default: '1800', allowUnlimited: true, description: '单次运行超时（秒），超时则强制中断。开启 Unlimited=不设截止，适合长任务。' },
      { key: 'permission_mode', label: 'Permission Mode', type: 'select', options: ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'], default: 'acceptEdits', description: '工具授权模式。default=每次询问；acceptEdits=自动批准编辑+常用文件命令；plan=只读分析不改文件；auto=自动批准大部分操作（后台安全检查，需 CLI v2.1.83+）；dontAsk=仅放行白名单工具，其余拒绝（适合非交互/CI）；bypassPermissions=跳过所有检查（仅限沙箱）。' },
      { key: 'allowed_tools', label: 'Allowed Tools', type: 'text', default: '', description: '允许免授权执行的工具白名单，逗号分隔。如: Bash(git *), Edit, Read。需配合 permission_mode 使用。' },
    ],
  },
  {
    slug: 'claude-code', name: 'Claude Code', description: "Anthropic's coding agent. Uses Claude Sonnet / Opus.", installed: false,
    install_hint: 'npm install -g @anthropic-ai/claude-code', docs_url: 'https://docs.anthropic.com/en/docs/claude-code',
    params: [
      { key: 'model', label: 'Model', type: 'select', options: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'], default: 'claude-sonnet-4-6', description: 'Claude model to use.' },
      { key: 'bare', label: 'Bare Mode', type: 'toggle', default: 'false', description: '极简模式：跳过工具、技能、上下文加载，节省 token。适合简单问答。' },
      { key: 'max_turns', label: 'Max Turns', type: 'number', default: '10', min: 1, allowUnlimited: true, description: '最大 agentic 轮数。1=纯对话无工具，5-10=允许读文件/搜索等，更高=复杂任务。开启 Unlimited=跑到自然结束。' },
      { key: 'timeout', label: 'Timeout (s)', type: 'number', default: '1800', allowUnlimited: true, description: '单次运行超时（秒），超时则强制中断。开启 Unlimited=不设截止，适合长任务。' },
      { key: 'permission_mode', label: 'Permission Mode', type: 'select', options: ['default', 'auto', 'bypassPermissions'], default: 'default', description: '工具授权模式。default=每次询问，auto=自动批准大部分操作，bypassPermissions=跳过所有检查（仅限沙箱环境）。' },
      { key: 'allowed_tools', label: 'Allowed Tools', type: 'text', default: '', description: '允许免授权执行的工具白名单，逗号分隔。如: Bash(git *), Edit, Read。需配合 permission_mode 使用。' },
    ],
  },
  {
    slug: 'pi', name: 'Pi Agent', description: "Nous Research's Pi agent. Supports print, json, and rpc modes.", installed: false,
    install_hint: 'pip install pi-agent',
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['print', 'json', 'rpc'], default: 'json', description: 'Pi agent communication mode.' },
      { key: 'bare', label: 'Bare Mode', type: 'toggle', default: 'false', description: '极简模式：跳过工具、技能、上下文加载，节省 token。适合简单问答。' },
    ],
  },
]

// Agent slugs hidden from the settings UI. Still kept in DEFAULT_AGENTS for
// merge logic so the backend can surface them if needed.
const HIDDEN_AGENT_SLUGS = new Set(['claude-code'])

interface AgentSettingsProps {
  onAgentChanged?: (agent: string) => void
}

export function AgentSettings({ onAgentChanged }: AgentSettingsProps) {
  const [loading, setLoading] = useState(true)
  const [agents, setAgents] = useState<AgentInfo[]>(DEFAULT_AGENTS.filter(a => !HIDDEN_AGENT_SLUGS.has(a.slug)))
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
      const result = await window.nexusAgent.api<{
        agents: AgentInfo[]
        current: string
        current_params?: Record<string, string>
        all_params?: Record<string, Record<string, string>>
      }>({ path: '/api/agents/status', timeoutMs: 5000 })
      // Merge: use backend params as base, but union with DEFAULT_AGENTS so
      // params added in newer frontend code appear even when the sidecar
      // binary is stale (e.g. max_turns missing from an older build).
      const merged = (result.agents || []).map((apiAgent) => {
        const localDefault = DEFAULT_AGENTS.find(d => d.slug === apiAgent.slug)
        if (!localDefault?.params) return apiAgent
        const apiKeys = new Set(apiAgent.params?.map(p => p.key))
        const extraParams = localDefault.params.filter(p => !apiKeys.has(p.key))
        if (extraParams.length === 0) return apiAgent
        return { ...apiAgent, params: [...(apiAgent.params || []), ...extraParams] }
      })
      const visible = (merged.length > 0 ? merged : DEFAULT_AGENTS)
        .filter(a => !HIDDEN_AGENT_SLUGS.has(a.slug))
      setAgents(visible)
      // Sync shared atom with server truth
      if (result.current) {
        setCurrentProvider(result.current)
      }
      // Restore persisted params for ALL agents (not just current)
      if (result.all_params && Object.keys(result.all_params).length > 0) {
        setParamValues(prev => {
          const next = { ...prev }
          for (const [slug, params] of Object.entries(result.all_params!)) {
            next[slug] = { ...(prev[slug] || {}), ...params }
          }
          return next
        })
      }
    } catch {
      // Fallback: get current agent from /api/model/info and use defaults
      try {
        const info = await window.nexusAgent.api<{
          model: string
          provider: string
        }>({ path: '/api/model/info', timeoutMs: 5000 })
        setCurrentProvider(info.provider || 'claude-code-sdk')
        setAgents(DEFAULT_AGENTS.filter(a => !HIDDEN_AGENT_SLUGS.has(a.slug)))
      } catch (err) {
        setError('Could not reach agent-gateway backend. Make sure it is running.')
        setAgents(DEFAULT_AGENTS.filter(a => !HIDDEN_AGENT_SLUGS.has(a.slug)))
        setCurrentProvider('claude-code-sdk')
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
        await window.nexusAgent.api<{ ok: boolean }>({
          path: '/api/agents/switch',
          method: 'POST',
          body: { agent: slug, agent_params: agentParams },
          timeoutMs: 5000,
        })
      } catch {
        // Fallback to model/set
        await window.nexusAgent.api<{ ok: boolean }>({
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

  const setParamValue = async (agentSlug: string, key: string, value: string) => {
    const prevParams = paramValues[agentSlug] || {}
    const nextParams = { ...prevParams, [key]: value }
    setParamValues(prev => ({
      ...prev,
      [agentSlug]: nextParams,
    }))
    // Persist the param change to the backend immediately
    try {
      await window.nexusAgent.api<{ ok: boolean }>({
        path: '/api/agents/switch',
        method: 'POST',
        body: { agent: agentSlug, agent_params: nextParams },
        timeoutMs: 5000,
      })
    } catch (err) {
      notifyError(err, 'Failed to save agent parameter')
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

function NumberParamControl({
  onChange,
  param,
  value,
  disabled,
}: {
  onChange: (value: string) => void
  param: AgentParamDef
  value: string
  disabled: boolean
}) {
  // "Unlimited" is encoded as an empty string → gateway coerces to None
  // (timeout=None: no deadline; max_turns=None: run to natural completion).
  const unlimited = param.allowUnlimited && value === ''
  return (
    <div className="flex items-center gap-2">
      <Input
        className={cn(CONTROL_TEXT, 'h-7 w-28')}
        disabled={disabled || unlimited}
        max={param.max}
        min={param.min}
        onChange={e => {
          const v = e.target.value
          if (v === '' || /^\d+$/.test(v)) {
            onChange(v)
          }
        }}
        type="number"
        value={value}
      />
      {param.allowUnlimited && (
        <label className="flex items-center gap-1 text-[0.7rem] text-muted-foreground">
          <Switch
            checked={unlimited}
            disabled={disabled}
            onCheckedChange={checked => onChange(checked ? '' : param.default || '0')}
          />
          Unlimited
        </label>
      )}
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
  const hasParams = agent.params && agent.params.length > 0

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
                param.type === 'toggle' ? (
                  <Switch
                    checked={paramValues[param.key] === 'true'}
                    onCheckedChange={checked => onParamChange(param.key, checked ? 'true' : 'false')}
                    disabled={!agent.installed}
                  />
                ) : param.type === 'number' ? (
                  <NumberParamControl
                    onChange={v => onParamChange(param.key, v)}
                    param={param}
                    value={paramField(paramValues, param)}
                    disabled={!agent.installed}
                  />
                ) : param.type === 'text' ? (
                  <Input
                    type="text"
                    value={paramValues[param.key] || param.default || ''}
                    onChange={e => onParamChange(param.key, e.target.value)}
                    className={cn(CONTROL_TEXT, 'h-7 w-36')}
                    disabled={!agent.installed}
                  />
                ) : (
                  <Select
                    onValueChange={val => onParamChange(param.key, val === EMPTY_SELECT_VALUE ? '' : val)}
                    value={paramValues[param.key] || param.default || EMPTY_SELECT_VALUE}
                    disabled={!agent.installed}
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
                )
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
