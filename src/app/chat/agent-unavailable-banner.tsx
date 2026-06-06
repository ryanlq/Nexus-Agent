import { useStore } from '@nanostores/react'

import { Codicon } from '@/components/ui/codicon'
import { $agentAvailable, $agentUnavailableReason, $gatewayState } from '@/store/session'

/**
 * Banner shown in the chat area when the selected agent CLI is not installed.
 * Only visible when the gateway is connected (open) but no agent is available.
 */
export function AgentUnavailableBanner() {
  const agentAvailable = useStore($agentAvailable)
  const reason = useStore($agentUnavailableReason)
  const gatewayState = useStore($gatewayState)
  const gatewayOpen = gatewayState === 'open'

  // Don't show when gateway is disconnected or agent status is unknown
  if (!gatewayOpen || agentAvailable === null || agentAvailable === true) {
    return null
  }

  return (
    <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/5 px-4 py-2 text-xs text-warning">
      <Codicon className="shrink-0" name="warning" size={14} />
      <span className="flex-1">
        <strong>No agent available.</strong> {reason || 'Install an agent CLI to start chatting.'}
      </span>
      <button
        className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-warning hover:bg-warning/10"
        onClick={() => {
          window.hermesDesktop?.api?.({ path: '/api/agents/status', timeoutMs: 5000 }).then(() => {
            // Trigger a re-check by cycling the store
            $agentAvailable.set(null)
            setTimeout(() => $agentAvailable.set(false), 100)
          }).catch(() => {})
        }}
        type="button"
      >
        Retry
      </button>
    </div>
  )
}
