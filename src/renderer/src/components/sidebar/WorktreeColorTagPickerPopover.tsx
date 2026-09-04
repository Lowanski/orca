import React, { useCallback, useEffect, useState } from 'react'
import { HexColorPicker } from 'react-colorful'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import {
  normalizeWorkspaceColorTag,
  WORKSPACE_COLOR_TAG_SWATCHES
} from '../../../../shared/workspace-color-tag'

const SEED_COLOR = WORKSPACE_COLOR_TAG_SWATCHES[0]

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
 */
export function WorktreeColorTagPickerPopover({
  open,
  colorTag,
  menuPoint,
  onOpenChange,
  onCommitColorTag
}: WorktreeColorTagPickerPopoverProps): React.JSX.Element {
  const [draft, setDraft] = useState(() => colorTag ?? SEED_COLOR)

  useEffect(() => {
    if (open) {
      setDraft(colorTag ?? SEED_COLOR)
    }
  }, [colorTag, open])

  // Why: react-colorful fires on every pointer move. Persisting each one would issue a metadata
  // write per pixel — one per selected workspace — and slow hosts could land an intermediate
  // color after the final one. The drag drives local state only; the commit happens on release.
  const commit = useCallback(
    (value: string) => {
      const normalized = normalizeWorkspaceColorTag(value)
      if (normalized) {
        onCommitColorTag(normalized)
      }
    },
    [onCommitColorTag]
  )

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
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
        <div onPointerUp={() => commit(draft)} onBlur={() => commit(draft)}>
          <HexColorPicker color={draft} onChange={setDraft} />
        </div>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit(draft)
              onOpenChange(false)
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
