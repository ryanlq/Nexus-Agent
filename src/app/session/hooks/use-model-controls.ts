import { type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { getGlobalModelInfo, setGlobalModel } from '@/hermes'
import { notifyError } from '@/store/notifications'
import { $currentModel, $currentProvider, setCurrentModel, setCurrentProvider } from '@/store/session'
import type { ModelOptionsResponse } from '@/types/hermes'

interface ModelSelection {
  model: string
  persistGlobal: boolean
  provider: string
}

interface ModelControlsOptions {
  activeSessionId: string | null
  queryClient: QueryClient
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
}

export function useModelControls({ activeSessionId, queryClient, requestGateway }: ModelControlsOptions) {
  const updateModelOptionsCache = useCallback(
    (provider: string, model: string, includeGlobal: boolean) => {
      const patch = (prev: ModelOptionsResponse | undefined) => ({ ...(prev ?? {}), provider, model })

      queryClient.setQueryData<ModelOptionsResponse>(['model-options', activeSessionId || 'global'], patch)

      if (includeGlobal) {
        queryClient.setQueryData<ModelOptionsResponse>(['model-options', 'global'], patch)
      }
    },
    [activeSessionId, queryClient]
  )

  const refreshCurrentModel = useCallback(async () => {
    try {
      const result = await getGlobalModelInfo()

      if (typeof result.model === 'string') {
        setCurrentModel(result.model)
      }

      if (typeof result.provider === 'string') {
        setCurrentProvider(result.provider)
      }
    } catch {
      // The delayed session.info event still updates this once the agent is ready.
    }
  }, [])

  // Returns whether the switch succeeded so callers can await it before
  // applying follow-up changes.
  const selectModel = useCallback(
    async (selection: ModelSelection): Promise<boolean> => {
      const includeGlobal = selection.persistGlobal || !activeSessionId
      const prevModel = $currentModel.get()
      const prevProvider = $currentProvider.get()

      // Optimistic update
      setCurrentModel(selection.model)
      setCurrentProvider(selection.provider)
      updateModelOptionsCache(selection.provider, selection.model, includeGlobal)

      try {
        // agent-gateway: use config.set to switch agent
        if (activeSessionId) {
          await requestGateway('config.set', {
            key: 'agent',
            value: selection.provider,
            session_id: activeSessionId,
          })

          if (selection.persistGlobal) {
            void refreshCurrentModel()
          }

          void queryClient.invalidateQueries({
            queryKey: selection.persistGlobal ? ['model-options'] : ['model-options', activeSessionId]
          })

          return true
        }

        // No active session — switch global default via REST
        await setGlobalModel(selection.provider, selection.model)
        void refreshCurrentModel()
        void queryClient.invalidateQueries({ queryKey: ['model-options'] })

        return true
      } catch (err) {
        setCurrentModel(prevModel)
        setCurrentProvider(prevProvider)
        updateModelOptionsCache(prevProvider, prevModel, includeGlobal)
        notifyError(err, 'Agent switch failed')

        return false
      }
    },
    [activeSessionId, queryClient, refreshCurrentModel, requestGateway, updateModelOptionsCache]
  )

  return { refreshCurrentModel, selectModel, updateModelOptionsCache }
}
