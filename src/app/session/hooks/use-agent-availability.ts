import { useEffect } from 'react'
import { useStore } from '@nanostores/react'

import { $agentAvailable, $agentUnavailableReason, $currentProvider, $gatewayState } from '@/store/session'

/**
 * Checks whether the currently selected agent CLI is installed after the
 * gateway connection opens.  Sets `$agentAvailable` and
 * `$agentUnavailableReason` so the chat UI can react.
 */
export function useAgentAvailability() {
  const gatewayState = useStore($gatewayState)
  const currentProvider = useStore($currentProvider)
  const gatewayOpen = gatewayState === 'open'

  useEffect(() => {
    if (!gatewayOpen) return

    let cancelled = false

    async function check() {
      try {
        const result = await window.nexusAgent.api<{
          agents: Array<{ slug: string; installed: boolean }>
          current: string
        }>({ path: '/api/agents/status', timeoutMs: 5000 })

        if (cancelled) return

        const agents = result.agents ?? []
        const currentSlug = result.current || currentProvider
        const currentAgent = agents.find((a) => a.slug === currentSlug)

        if (currentAgent && currentAgent.installed) {
          $agentAvailable.set(true)
          $agentUnavailableReason.set('')
        } else {
          $agentAvailable.set(false)
          $agentUnavailableReason.set(
            currentAgent
              ? `${currentAgent.slug} is not installed on this system`
              : `No agent configured`
          )
        }
      } catch {
        if (!cancelled) {
          // Backend unreachable — don't block the UI, just mark unknown
          $agentAvailable.set(null)
          $agentUnavailableReason.set('')
        }
      }
    }

    void check()
    return () => { cancelled = true }
  }, [gatewayOpen, currentProvider])
}
