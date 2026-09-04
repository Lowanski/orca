import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Worktree } from '../../../../shared/worktree/types'
import { getSharedWorkspaceColorTag } from '../../../../shared/workspace-color-tag'
import { WorktreeColorTagPickerPopover } from './WorktreeColorTagPickerPopover'

// Why: the click that picks the swatch also closes the menu, and a popover opened in that same
// tick reads the tail of that click as an outside press and dismisses itself. Opening one frame
// after the menu has torn down is the same handoff the parent picker performs.
const MENU_HANDOFF_MS = 50

/**
 * Color-tag state for the workspace context menu.
 *
 * Returns the picker already rendered because it must mount as a *sibling* of the menu: a Popover
 * inside `DropdownMenuContent` unmounts the moment the menu closes, which is exactly when the
 * picker needs to appear.
 */
export function useWorktreeColorTagPicker(
  selectedWorktrees: readonly Worktree[],
  menuPoint: { x: number; y: number },
  onAssignColorTag: (colorTag: string | null) => void
): { sharedColorTag: string | null; openPicker: () => void; picker: React.JSX.Element } {
  const [open, setOpen] = useState(false)
  const handoffTimerRef = useRef<number | null>(null)
  // Why: toggle-off keys off the whole selection, so unifying a mixed selection assigns
  // rather than clears.
  const sharedColorTag = useMemo(
    () => getSharedWorkspaceColorTag(selectedWorktrees.map((item) => item.colorTag)),
    [selectedWorktrees]
  )

  useEffect(() => {
    return () => {
      if (handoffTimerRef.current != null) {
        window.clearTimeout(handoffTimerRef.current)
      }
    }
  }, [])

  const openPicker = useCallback(() => {
    if (handoffTimerRef.current != null) {
      window.clearTimeout(handoffTimerRef.current)
    }
    handoffTimerRef.current = window.setTimeout(() => {
      handoffTimerRef.current = null
      setOpen(true)
    }, MENU_HANDOFF_MS)
  }, [])

  return {
    sharedColorTag,
    openPicker,
    picker: (
      <WorktreeColorTagPickerPopover
        open={open}
        colorTag={sharedColorTag}
        menuPoint={menuPoint}
        onOpenChange={setOpen}
        onCommitColorTag={onAssignColorTag}
      />
    )
  }
}
