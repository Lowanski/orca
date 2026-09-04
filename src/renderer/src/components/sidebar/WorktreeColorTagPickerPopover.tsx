import React, { useCallback, useEffect, useRef, useState } from 'react'
import { HexColorPicker } from 'react-colorful'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import {
  normalizeWorkspaceColorTag,
  WORKSPACE_COLOR_TAG_SWATCHES
} from '../../../../shared/workspace-color-tag'

const SEED_COLOR = WORKSPACE_COLOR_TAG_SWATCHES[0]
const FULL_HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/

type WorktreeColorTagPickerPopoverProps = {
  open: boolean
  colorTag: string | null
  /** Right-click point inside the card's relative scope, so the picker lands where the menu was. */
  menuPoint: { x: number; y: number }
  onOpenChange: (open: boolean) => void
  onCommitColorTag: (colorTag: string | null) => void
}

/**
 * Custom-color surface for the workspace color tag. A Popover rather than a menu submenu so the
 * hex field and the picker's own arrow-key handling are actually reachable — a Radix menu manages
 * its own focus and swallows Tab, leaving non-item content keyboard-dead.
 *
 * Every change is forwarded so the card previews live (the store applies metadata optimistically);
 * the caller coalesces persistence. Closing or pressing Enter forwards the final value once more so
 * whatever the user last saw is what settles on disk.
 */
export function WorktreeColorTagPickerPopover({
  open,
  colorTag,
  menuPoint,
  onOpenChange,
  onCommitColorTag
}: WorktreeColorTagPickerPopoverProps): React.JSX.Element {
  const [draft, setDraft] = useState(() => colorTag ?? SEED_COLOR)
  // Why: the seed is only a starting point for the wheel. Opening and closing without touching
  // anything must not stamp that seed onto an untagged workspace.
  const dirtyRef = useRef(false)

  useEffect(() => {
    if (open) {
      setDraft(colorTag ?? SEED_COLOR)
      dirtyRef.current = false
    }
  }, [colorTag, open])

  const preview = useCallback(
    (value: string) => {
      setDraft(value)
      if (!FULL_HEX_COLOR_PATTERN.test(value.trim())) {
        return
      }
      dirtyRef.current = true
      onCommitColorTag(normalizeWorkspaceColorTag(value))
    },
    [onCommitColorTag]
  )

  const close = useCallback(() => {
    if (dirtyRef.current && FULL_HEX_COLOR_PATTERN.test(draft.trim())) {
      onCommitColorTag(normalizeWorkspaceColorTag(draft))
    }
    onOpenChange(false)
  }, [draft, onCommitColorTag, onOpenChange])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpenChange(true)
          return
        }
        close()
      }}
    >
      <PopoverAnchor asChild>
        <span
          aria-hidden
          className="pointer-events-none absolute size-px opacity-0"
          style={{ left: menuPoint.x, top: menuPoint.y }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-auto space-y-2 p-2"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <HexColorPicker color={draft} onChange={preview} />
        <Input
          value={draft}
          onChange={(event) => preview(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              close()
            }
          }}
          aria-label={translate(
            'auto.components.sidebar.WorktreeColorTagMenuItems.hex',
            'Hex color'
          )}
          className="h-7 w-full text-xs"
        />
      </PopoverContent>
    </Popover>
  )
}
