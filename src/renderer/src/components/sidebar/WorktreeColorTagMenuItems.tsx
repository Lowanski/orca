import React, { useCallback, useRef, useState } from 'react'
import { Slash } from 'lucide-react'

import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  resolveWorkspaceColorTagSelection,
  WORKSPACE_COLOR_TAG_SWATCHES
} from '../../../../shared/workspace-color-tag'

/** Swatch identity: null clears the tag, `custom` opens the picker, a hex assigns directly. */
type SwatchOption = string | null | 'custom'

// The empty slot leads and the custom wheel closes the row, so the presets read as one strip.
const SWATCH_OPTIONS: readonly SwatchOption[] = [null, ...WORKSPACE_COLOR_TAG_SWATCHES, 'custom']

// Why inline: it is a swatch, not a token — the wheel names the picker the way the hexes name
// themselves, and no palette entry can stand for "any color".
const CUSTOM_SWATCH_GRADIENT =
  'conic-gradient(#ef4444, #eab308, #22c55e, #14b8a6, #8b5cf6, #ec4899, #ef4444)'

type WorktreeColorTagMenuItemsProps = {
  colorTag: string | null
  disabled: boolean
  isMultiContext: boolean
  onAssignColorTag: (colorTag: string | null) => void
  onOpenCustomPicker: () => void
}

function getInitialSwatchIndex(colorTag: string | null): number {
  const index = SWATCH_OPTIONS.indexOf(colorTag)
  return index === -1 ? 0 : index
}

function getSwatchLabel(swatch: SwatchOption, isSelected: boolean): string {
  if (swatch === null) {
    return translate('auto.components.sidebar.WorktreeColorTagMenuItems.noColor', 'No color')
  }
  if (swatch === 'custom') {
    return translate('auto.components.sidebar.WorktreeColorTagMenuItems.custom', 'Custom color')
  }
  return isSelected
    ? translate(
        'auto.components.sidebar.WorktreeColorTagMenuItems.removeColor',
        'Remove color {{value0}}',
        { value0: swatch }
      )
    : translate(
        'auto.components.sidebar.WorktreeColorTagMenuItems.useColor',
        'Use color {{value0}}',
        { value0: swatch }
      )
}

export function WorktreeColorTagMenuItems({
  colorTag,
  disabled,
  isMultiContext,
  onAssignColorTag,
  onOpenCustomPicker
}: WorktreeColorTagMenuItemsProps): React.JSX.Element {
  const [activeIndex, setActiveIndex] = useState(() => getInitialSwatchIndex(colorTag))
  // Why: the row is one menu stop, so the swatch a click or Enter lands on has to
  // survive into the item's onSelect without waiting for a state re-render.
  const activeIndexRef = useRef(activeIndex)

  const moveActiveIndex = useCallback((index: number) => {
    const wrapped = (index + SWATCH_OPTIONS.length) % SWATCH_OPTIONS.length
    activeIndexRef.current = wrapped
    setActiveIndex(wrapped)
  }, [])

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return
      }
      // Why: horizontal arrows belong to the row; letting them bubble would close
      // the menu or jump to a sibling submenu instead of moving between swatches.
      event.preventDefault()
      event.stopPropagation()
      moveActiveIndex(activeIndexRef.current + (event.key === 'ArrowRight' ? 1 : -1))
    },
    [moveActiveIndex]
  )

  const handleSelect = useCallback(() => {
    const swatch = SWATCH_OPTIONS[activeIndexRef.current]
    if (swatch === 'custom') {
      onOpenCustomPicker()
      return
    }
    onAssignColorTag(resolveWorkspaceColorTagSelection(colorTag, swatch))
  }, [colorTag, onAssignColorTag, onOpenCustomPicker])

  return (
    <DropdownMenuItem
      disabled={disabled}
      className="px-2 py-1.5 focus:bg-transparent dark:focus:bg-transparent"
      onSelect={handleSelect}
      onKeyDown={handleRowKeyDown}
      aria-label={
        isMultiContext
          ? translate(
              'auto.components.sidebar.WorktreeColorTagMenuItems.groupColorMulti',
              'Group color for selected workspaces'
            )
          : translate('auto.components.sidebar.WorktreeColorTagMenuItems.groupColor', 'Group color')
      }
    >
      <div className="flex w-full items-center justify-between gap-1" role="radiogroup">
        {SWATCH_OPTIONS.map((swatch, index) => {
          const isSelected = swatch === colorTag
          const isCustom = swatch === 'custom'
          return (
            <button
              key={swatch ?? 'none'}
              type="button"
              role={isCustom ? 'menuitem' : 'radio'}
              tabIndex={-1}
              aria-checked={isCustom ? undefined : isSelected}
              aria-haspopup={isCustom ? 'dialog' : undefined}
              aria-label={getSwatchLabel(swatch, isSelected)}
              data-workspace-color-swatch={swatch ?? 'none'}
              onPointerEnter={() => moveActiveIndex(index)}
              onClick={() => {
                activeIndexRef.current = index
              }}
              className={cn(
                'flex size-4 items-center justify-center rounded-full outline-none transition-shadow',
                swatch === null && 'border border-border text-muted-foreground',
                isSelected && 'ring-2 ring-foreground ring-offset-2 ring-offset-popover',
                !isSelected &&
                  index === activeIndex &&
                  'ring-1 ring-muted-foreground ring-offset-2 ring-offset-popover'
              )}
              style={
                isCustom
                  ? { backgroundImage: CUSTOM_SWATCH_GRADIENT }
                  : swatch === null
                    ? undefined
                    : { backgroundColor: swatch }
              }
            >
              {swatch === null ? <Slash className="size-2.5" /> : null}
            </button>
          )
        })}
      </div>
    </DropdownMenuItem>
  )
}
