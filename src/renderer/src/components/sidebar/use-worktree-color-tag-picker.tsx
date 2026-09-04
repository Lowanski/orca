import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Worktree } from '../../../../shared/worktree/types'
import { getSharedWorkspaceColorTag } from '../../../../shared/workspace-color-tag'
import { WorktreeColorTagPickerPopover } from './WorktreeColorTagPickerPopover'

// Why: the menu plays an exit animation, and Radix fires onCloseAutoFocus only once it finishes.
// A picker opened before that runs gets its focus yanked to the sidebar by the menu's own focus
// restore, and Radix dismisses the popover on focus-outside. This timer is only the fallback for
// a teardown that never fires onCloseAutoFocus; the normal path is the handoff below.
const CLOSE_AUTO_FOCUS_FALLBACK_MS = 250

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
  onAssignColorTag: (colorTag: string | null) => void,
  /** The menu's own focus restore, run only when no picker is pending. */
  restoreMenuFocus: (event: Event) => void
): {
  sharedColorTag: string | null
  openPicker: () => void
  handleMenuCloseAutoFocus: (event: Event) => void
  picker: React.JSX.Element
} {
  const [open, setOpen] = useState(false)
  const pendingRef = useRef(false)
  const fallbackTimerRef = useRef<number | null>(null)

  const clearFallback = useCallback(() => {
    if (fallbackTimerRef.current != null) {
      window.clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }
  }, [])

  const flushPendingOpen = useCallback(() => {
    if (!pendingRef.current) {
      return
    }
    pendingRef.current = false
    clearFallback()
    setOpen(true)
  }, [clearFallback])

  useEffect(() => clearFallback, [clearFallback])

  const openPicker = useCallback(() => {
    pendingRef.current = true
    clearFallback()
    fallbackTimerRef.current = window.setTimeout(flushPendingOpen, CLOSE_AUTO_FOCUS_FALLBACK_MS)
  }, [clearFallback, flushPendingOpen])

  const handleMenuCloseAutoFocus = useCallback(
    (event: Event): void => {
      if (!pendingRef.current) {
        restoreMenuFocus(event)
        return
      }
      // Why preventDefault and no focus restore: sending focus to the sidebar here is a
      // focus-outside for the popover about to open, which dismisses it on arrival.
      event.preventDefault()
      window.setTimeout(flushPendingOpen, 0)
    },
    [flushPendingOpen, restoreMenuFocus]
  )

  // Why: toggle-off keys off the whole selection, so unifying a mixed selection assigns
  // rather than clears.
  const sharedColorTag = useMemo(
    () => getSharedWorkspaceColorTag(selectedWorktrees.map((item) => item.colorTag)),
    [selectedWorktrees]
  )

  return {
    sharedColorTag,
    openPicker,
    handleMenuCloseAutoFocus,
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
