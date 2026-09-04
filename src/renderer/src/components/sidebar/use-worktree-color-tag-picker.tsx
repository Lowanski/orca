import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Worktree } from '../../../../shared/worktree/types'
import {
  getSharedWorkspaceColorTag,
  isMixedWorkspaceColorTagSelection
} from '../../../../shared/workspace-color-tag'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { WorktreeColorTagMenuItems } from './WorktreeColorTagMenuItems'
import { WorktreeColorTagPickerPopover } from './WorktreeColorTagPickerPopover'

// Why: the menu plays an exit animation, and Radix fires onCloseAutoFocus only once it finishes.
// A picker opened before that runs gets its focus yanked to the sidebar by the menu's own focus
// restore, and Radix dismisses the popover on focus-outside. This timer is only the fallback for
// a teardown that never fires onCloseAutoFocus; the normal path is the handoff below.
const CLOSE_AUTO_FOCUS_FALLBACK_MS = 250

type WorktreeColorTagPickerArgs = {
  /** The selection the menu is acting on — the live context set, not the clicked row alone. */
  contextWorktrees: readonly Worktree[]
  menuPoint: { x: number; y: number }
  /** Any selected workspace is deleting, so the row must not write into a half-failing batch. */
  disabled: boolean
  isMultiContext: boolean
  onAssignColorTag: (colorTag: string | null, targets: readonly Worktree[]) => void
  /** The menu's own focus restore, run only when no picker is pending. */
  restoreMenuFocus: (event: Event) => void
}

/**
 * The color-tag section of the workspace context menu: the swatch row that renders inside the
 * menu and the custom picker that renders beside it.
 *
 * Both come back already rendered. The picker must mount as a *sibling* of the menu — a Popover
 * inside `DropdownMenuContent` unmounts the moment the menu closes, which is exactly when the
 * picker needs to appear — and owning the row here keeps the view free of color-tag plumbing.
 */
export function useWorktreeColorTagPicker({
  contextWorktrees,
  menuPoint,
  disabled,
  isMultiContext,
  onAssignColorTag,
  restoreMenuFocus
}: WorktreeColorTagPickerArgs): {
  sharedColorTag: string | null
  mixed: boolean
  openPicker: () => void
  handleMenuCloseAutoFocus: (event: Event) => void
  /** Swatch row plus its trailing separator; render inside `DropdownMenuContent`. */
  menuItems: React.JSX.Element
  picker: React.JSX.Element
} {
  const [open, setOpen] = useState(false)
  // Why snapshot: the menu's selection only exists while the menu is open. Once it closes the
  // model falls back to the clicked row, and a folder row passes no selection at all, so the
  // picker would preview and commit a single workspace when the user right-clicked several.
  const [snapshot, setSnapshot] = useState<readonly Worktree[] | null>(null)
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
    setSnapshot(contextWorktrees)
    pendingRef.current = true
    clearFallback()
    fallbackTimerRef.current = window.setTimeout(flushPendingOpen, CLOSE_AUTO_FOCUS_FALLBACK_MS)
  }, [clearFallback, contextWorktrees, flushPendingOpen])

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

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (!next) {
      setSnapshot(null)
    }
  }, [])

  const contextTags = useMemo(
    () => contextWorktrees.map((item) => item.colorTag),
    [contextWorktrees]
  )
  // Why: toggle-off keys off the whole selection, so unifying a mixed selection assigns
  // rather than clears.
  const sharedColorTag = useMemo(() => getSharedWorkspaceColorTag(contextTags), [contextTags])
  const mixed = useMemo(() => isMixedWorkspaceColorTagSelection(contextTags), [contextTags])

  const pickerTargets = snapshot ?? contextWorktrees
  const pickerColorTag = useMemo(
    () => getSharedWorkspaceColorTag(pickerTargets.map((item) => item.colorTag)),
    [pickerTargets]
  )
  const previewIdentities = useMemo(
    () => pickerTargets.map((item) => getWorktreeHostIdentity(item)),
    [pickerTargets]
  )
  const commitPickerColorTag = useCallback(
    (colorTag: string | null) => onAssignColorTag(colorTag, pickerTargets),
    [onAssignColorTag, pickerTargets]
  )
  // Why: the row acts while the menu is open, so its targets are the live context selection.
  const assignFromRow = useCallback(
    (colorTag: string | null) => onAssignColorTag(colorTag, contextWorktrees),
    [contextWorktrees, onAssignColorTag]
  )

  return {
    sharedColorTag,
    mixed,
    openPicker,
    handleMenuCloseAutoFocus,
    menuItems: (
      <>
        <WorktreeColorTagMenuItems
          colorTag={sharedColorTag}
          mixed={mixed}
          disabled={disabled}
          isMultiContext={isMultiContext}
          onAssignColorTag={assignFromRow}
          onOpenCustomPicker={openPicker}
        />
        <DropdownMenuSeparator />
      </>
    ),
    picker: (
      <WorktreeColorTagPickerPopover
        open={open}
        colorTag={pickerColorTag}
        menuPoint={menuPoint}
        previewIdentities={previewIdentities}
        onOpenChange={handleOpenChange}
        onCommitColorTag={commitPickerColorTag}
      />
    )
  }
}
