import { atom } from 'nanostores'

import type { DesktopVersionInfo } from '@/global'

export const $desktopVersion = atom<DesktopVersionInfo | null>(null)

export async function refreshDesktopVersion(): Promise<DesktopVersionInfo | null> {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const next = await window.nexusAgent?.getVersion?.()

    if (next) {
      $desktopVersion.set(next)
    }

    return next ?? null
  } catch {
    return null
  }
}
