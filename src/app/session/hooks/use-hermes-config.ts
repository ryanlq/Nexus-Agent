import { type MutableRefObject, useCallback, useState } from 'react'

import { getHermesConfig, getHermesConfigDefaults } from '@/nexus'
import { BUILTIN_PERSONALITIES, normalizePersonalityValue, personalityNamesFromConfig } from '@/lib/chat-runtime'
import {
  $currentCwd,
  setAvailablePersonalities,
  setCurrentCwd,
  setCurrentFastMode,
  setCurrentPersonality,
  setCurrentReasoningEffort,
  setCurrentServiceTier,
  setIntroPersonality
} from '@/store/session'

const DEFAULT_VOICE_SECONDS = 120
const FAST_TIERS = new Set(['fast', 'priority', 'on'])

function recordingLimit(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_VOICE_SECONDS
}

/** Read the default project dir from Electron's project-dir.json (set via the UI picker). */
async function getElectronDefaultProjectDir(): Promise<string> {
  const settings = window.nexusAgent?.settings
  if (!settings) return ''
  try {
    const result = await settings.getDefaultProjectDir()
    return result.dir?.trim() || ''
  } catch {
    return ''
  }
}

interface HermesConfigOptions {
  activeSessionIdRef: MutableRefObject<string | null>
  refreshProjectBranch: (cwd: string) => Promise<void>
}

export function useHermesConfig({ activeSessionIdRef, refreshProjectBranch }: HermesConfigOptions) {
  const [voiceMaxRecordingSeconds, setVoiceMaxRecordingSeconds] = useState(DEFAULT_VOICE_SECONDS)
  const [sttEnabled, setSttEnabled] = useState(true)

  const refreshHermesConfig = useCallback(async () => {
    try {
      const [config, defaults] = await Promise.all([getHermesConfig(), getHermesConfigDefaults().catch(() => ({}))])

      const personality = normalizePersonalityValue(
        typeof config.display?.personality === 'string' ? config.display.personality : ''
      )

      setIntroPersonality(personality)
      // Active sessions keep their per-session value; standalone falls back to config.
      setCurrentPersonality(prev => (activeSessionIdRef.current ? prev || personality : personality))
      setAvailablePersonalities([
        ...new Set([
          'none',
          ...BUILTIN_PERSONALITIES,
          ...personalityNamesFromConfig(defaults),
          ...personalityNamesFromConfig(config)
        ])
      ])

      // Resolve cwd: try hermes_config.terminal.cwd first, then Electron's project-dir.json
      let cwd = (config.terminal?.cwd ?? '').trim()
      if (!cwd || cwd === '.') {
        cwd = await getElectronDefaultProjectDir()
      }

      if (cwd && cwd !== '.') {
        setCurrentCwd(prev => prev || cwd)
        void refreshProjectBranch($currentCwd.get() || cwd)
      }

      const reasoning = (config.agent?.reasoning_effort ?? '').trim()
      const tier = (config.agent?.service_tier ?? '').trim()

      setCurrentReasoningEffort(prev => (activeSessionIdRef.current ? prev : reasoning))
      setCurrentServiceTier(prev => (activeSessionIdRef.current ? prev : tier))
      setCurrentFastMode(prev => (activeSessionIdRef.current ? prev : FAST_TIERS.has(tier.toLowerCase())))

      setVoiceMaxRecordingSeconds(recordingLimit(config.voice?.max_recording_seconds))
      setSttEnabled(config.stt?.enabled !== false)
    } catch {
      // Config is nice-to-have; chat still works without it.
    }
  }, [activeSessionIdRef, refreshProjectBranch])

  return { refreshHermesConfig, sttEnabled, voiceMaxRecordingSeconds }
}
