// Shared UI state for creating a loop. Two entry points converge here:
//   1. The Loops panel's "New loop" button.
//   2. Typing `/loop` in the chat composer — which pre-fills any args the
//      user already typed (`/loop 10m check deploy`) and opens this same dialog.
//
// A single CreateLoopDialog rendered at the controller level subscribes to
// $createLoop; both entry points just call openCreateLoopDialog(). $loopsNonce
// lets an already-open Loops panel reload when a loop is created elsewhere.

import { atom } from 'nanostores'

export interface CreateLoopPrefill {
  interval: string
  prompt: string
}

interface CreateLoopState {
  open: boolean
  prefill: CreateLoopPrefill
}

const DEFAULT_PREFILL: CreateLoopPrefill = { interval: '10m', prompt: '' }

export const $createLoop = atom<CreateLoopState>({
  open: false,
  prefill: { ...DEFAULT_PREFILL },
})

/** Monotonic counter bumped whenever loops change externally (e.g. created via
 * the dialog). An open Loops panel subscribes and reloads on change. */
export const $loopsNonce = atom(0)

export const openCreateLoopDialog = (prefill?: Partial<CreateLoopPrefill>): void => {
  $createLoop.set({
    open: true,
    prefill: {
      interval: prefill?.interval?.trim() || DEFAULT_PREFILL.interval,
      prompt: prefill?.prompt ?? '',
    },
  })
}

export const closeCreateLoopDialog = (): void => {
  $createLoop.set({ ...$createLoop.get(), open: false })
}

export const bumpLoopsNonce = (): void => {
  $loopsNonce.set($loopsNonce.get() + 1)
}
