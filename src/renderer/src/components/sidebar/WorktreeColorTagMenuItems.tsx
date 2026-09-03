import React, { useCallback, useRef, useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import { Palette } from 'lucide-react'

import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  normalizeWorkspaceColorTag,
  WORKSPACE_COLOR_TAG_NONE,
  WORKSPACE_COLOR_TAG_SWATCHES
} from '../../../../shared/workspace-color-tag'

const FULL_HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/

type WorktreeColorTagMenuItemsProps = {
  colorTag: string | null
  disabled: boolean
  isMultiContext: boolean
  onAssignColorTag: (colorTag: string | null) => void
}

function getInitialSwatchIndex(colorTag: string | null): number {
  const index =
    colorTag === null ? -1 : (WORKSPACE_COLOR_TAG_SWATCHES as readonly string[]).indexOf(colorTag)
  return index === -1 ? 0 : index
}

function getSwatchLabel(swatch: string): string {
  return swatch === WORKSPACE_COLOR_TAG_NONE
    ? translate('auto.components.sidebar.WorktreeColorTagMenuItems.noColor', 'No color')
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
  onAssignColorTag
}: WorktreeColorTagMenuItemsProps): React.JSX.Element {
  const [activeIndex, setActiveIndex] = useState(() => getInitialSwatchIndex(colorTag))
  // Why: the row is one menu stop, so the swatch a click or Enter lands on has to
  // survive into the item's onSelect without waiting for a state re-render.
  const activeIndexRef = useRef(activeIndex)
  const [draft, setDraft] = useState(() => colorTag ?? WORKSPACE_COLOR_TAG_NONE)

  const moveActiveIndex = useCallback((index: number) => {
    const wrapped =
      (index + WORKSPACE_COLOR_TAG_SWATCHES.length) % WORKSPACE_COLOR_TAG_SWATCHES.length
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

  const commitDraft = useCallback(
    (value: string) => {
      setDraft(value)
      // Why: assign only on a complete hex so a half-typed "#ab" does not clear the tag.
      if (FULL_HEX_COLOR_PATTERN.test(value.trim())) {
        onAssignColorTag(normalizeWorkspaceColorTag(value))
      }
    },
    [onAssignColorTag]
  )

  return (
    <>
      <DropdownMenuItem
        disabled={disabled}
        className="px-2 py-1.5 focus:bg-transparent dark:focus:bg-transparent"
        onSelect={() =>
          onAssignColorTag(
            normalizeWorkspaceColorTag(WORKSPACE_COLOR_TAG_SWATCHES[activeIndexRef.current])
          )
        }
        onKeyDown={handleRowKeyDown}
        aria-label={
          isMultiContext
            ? translate(
                'auto.components.sidebar.WorktreeColorTagMenuItems.groupColorMulti',
                'Group color for selected workspaces'
              )
            : translate(
                'auto.components.sidebar.WorktreeColorTagMenuItems.groupColor',
                'Group color'
              )
        }
      >
        <div className="flex w-full items-center justify-between gap-1" role="radiogroup">
          {WORKSPACE_COLOR_TAG_SWATCHES.map((swatch, index) => {
            const isSelected = swatch === (colorTag ?? WORKSPACE_COLOR_TAG_NONE)
            return (
              <button
                key={swatch}
                type="button"
                role="radio"
                tabIndex={-1}
                aria-checked={isSelected}
                aria-label={getSwatchLabel(swatch)}
                onPointerEnter={() => moveActiveIndex(index)}
                onClick={() => {
                  activeIndexRef.current = index
                }}
                className={cn(
                  'size-4 rounded-full outline-none transition-shadow',
                  isSelected && 'ring-2 ring-foreground ring-offset-2 ring-offset-popover',
                  !isSelected &&
                    index === activeIndex &&
                    'ring-1 ring-muted-foreground ring-offset-2 ring-offset-popover'
                )}
                style={{ backgroundColor: swatch }}
              />
            )
          })}
        </div>
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={disabled}>
          <Palette className="size-3.5" />
          {translate('auto.components.sidebar.WorktreeColorTagMenuItems.custom', 'Custom color')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          className="w-auto space-y-2 p-2"
          // Why: react-colorful and the hex field own their keys; the menu's typeahead
          // would otherwise swallow every character typed into the input.
          onKeyDown={(event) => event.stopPropagation()}
        >
          <HexColorPicker color={draft} onChange={commitDraft} />
          <Input
            value={draft}
            onChange={(event) => commitDraft(event.target.value)}
            aria-label={translate(
              'auto.components.sidebar.WorktreeColorTagMenuItems.hex',
              'Hex color'
            )}
            className="h-7 w-full text-xs"
          />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}
