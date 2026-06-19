import { atom } from 'nanostores'

export type RightSidebarTabId = 'files' | 'git' | 'web'

export const $rightSidebarTab = atom<RightSidebarTabId>('files')

export const setRightSidebarTab = (tab: RightSidebarTabId) => $rightSidebarTab.set(tab)
