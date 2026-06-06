import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { profileColorSoft, resolveProfileColor } from '@/lib/profile-color'
import { cn } from '@/lib/utils'
import {
  $activeGatewayProfile,
  $profileColors,
  $profileOrder,
  $profiles,
  $profileScope,
  ALL_PROFILES,
  normalizeProfileKey,
  refreshActiveProfile,
  selectProfile,
  setShowAllProfiles,
  sortByProfileOrder
} from '@/store/profile'

// Simplified profile rail for agent-gateway: single-profile mode only.
// Multi-profile DnD and management dialogs have been removed.
export function ProfileRail() {
  const profiles = useStore($profiles)
  const scope = useStore($profileScope)
  const gatewayProfile = useStore($activeGatewayProfile)
  const colors = useStore($profileColors)
  const order = useStore($profileOrder)

  const isAll = scope === ALL_PROFILES
  const activeKey = normalizeProfileKey(gatewayProfile)
  const defaultProfile = profiles.find(profile => profile.is_default)
  const onDefault = !isAll && activeKey === 'default'

  const named = sortByProfileOrder(profiles.filter(profile => !profile.is_default), order)
  const multiProfile = profiles.length > 1

  // Re-pull the running profile + list on mount so a profile created elsewhere
  // shows up; cheap and best-effort.
  useEffect(() => {
    void refreshActiveProfile()
  }, [])

  return (
    <div aria-label="Profiles" className="flex items-center gap-0.5" role="tablist">
      {multiProfile &&
        (defaultProfile ? (
          <ProfilePill
            active={isAll || onDefault}
            glyph={isAll ? 'layers' : 'home'}
            label={onDefault ? 'Show all profiles' : `Switch to ${defaultProfile.name}`}
            onSelect={() => (onDefault ? setShowAllProfiles(true) : selectProfile(defaultProfile.name))}
          />
        ) : (
          <ProfilePill active={isAll} glyph="layers" label="All profiles" onSelect={() => setShowAllProfiles(true)} />
        ))}

      {/* Single-profile (agent-gateway default): just the home icon */}
      {!multiProfile && defaultProfile && (
        <ProfilePill active glyph="home" label={defaultProfile.name} onSelect={() => selectProfile(defaultProfile.name)} />
      )}

      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {multiProfile && (
          <div className="relative flex items-center gap-1">
            {named.map(profile => (
              <ProfileSquareSimple
                active={!isAll && normalizeProfileKey(profile.name) === activeKey}
                color={resolveProfileColor(profile.name, colors)}
                key={profile.name}
                label={profile.name}
                onSelect={() => selectProfile(profile.name)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface ProfilePillProps {
  active: boolean
  // home / All / Manage are glyph action buttons (navigation, not identity).
  glyph: string
  label: string
  onSelect: () => void
}

function ProfilePill({ active, glyph, label, onSelect }: ProfilePillProps) {
  return (
    <Tip label={label}>
      <Button
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'bg-transparent text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground',
          active && 'bg-(--ui-control-active-background) text-foreground'
        )}
        onClick={onSelect}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <Codicon name={glyph} size="0.875rem" />
      </Button>
    </Tip>
  )
}

// Simplified profile square for agent-gateway (no DnD, no context menu, no color picker).
interface ProfileSquareSimpleProps {
  active: boolean
  color: null | string
  label: string
  onSelect: () => void
}

function ProfileSquareSimple({ active, color, label, onSelect }: ProfileSquareSimpleProps) {
  const hue = color ?? 'var(--ui-text-quaternary)'

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={cn(
              'grid size-5 shrink-0 select-none place-items-center rounded-[3px] text-[0.5625rem] font-semibold uppercase leading-none transition-opacity hover:opacity-100',
              active ? 'opacity-100' : 'opacity-55'
            )}
            onClick={onSelect}
            style={{
              backgroundColor: profileColorSoft(hue, active ? 30 : 22),
              boxShadow: active ? `inset 0 0 0 1.5px ${hue}` : undefined,
              color: color ?? undefined
            }}
            type="button"
            aria-label={label}
            aria-pressed={active}
          >
            {label.replace(/[^a-z0-9]/gi, '').charAt(0) || '?'}
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
