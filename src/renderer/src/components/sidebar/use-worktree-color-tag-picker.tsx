import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Worktree } from '../../../../shared/worktree/types'
import {
  getSharedWorkspaceColorTag,
  getWorkspaceColorTagIdentity,
  isMixedWorkspaceColorTagSelection
} from '../../../../shared/workspace-color-tag'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { WorktreeColorTagMenuItems } from './WorktreeColorTagMenuItems'
import { useWorkspaceColorTagPreviewsForWorktrees } from './workspace-color-tag-preview'
import { WorktreeColorTagPickerPopover } from './WorktreeColorTagPickerPopover'
import {
  CLOSE_ALL_CONTEXT_MENUS_EVENT,
  PARENT_PICKER_EXIT_ANIMATION_MS
} from './worktree-context-menu-policy'

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
  /** Resolves once the write has landed in the store, so the picker can hold its preview. */
  onAssignColorTag: (colorTag: string | null, targets: readonly Worktree[]) => Promise<void>
  /** The menu's own focus restore, run only when no picker is pending. */
  restoreMenuFocus: (event: Event) => void
  /** Tells the menu model a picker is pending or open, so its lifecycle does not complete under it. */
  onActiveChange: (active: boolean) => void
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
  restoreMenuFocus,
  onActiveChange
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
  const inactiveTimerRef = useRef<number | null>(null)

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

  const clearInactiveTimer = useCallback(() => {
    if (inactiveTimerRef.current != null) {
      window.clearTimeout(inactiveTimerRef.current)
      inactiveTimerRef.current = null
    }
  }, [])

  useEffect(
    () => () => {
      clearFallback()
      clearInactiveTimer()
    },
    [clearFallback, clearInactiveTimer]
  )

  // Why: a right-click on another card during this menu's exit animation opens a new menu and
  // broadcasts close-all, but the handoff would still open this picker over that menu with the old
  // selection as its targets. Superseded means cancelled.
  useEffect(() => {
    const cancelPending = (): void => {
      if (!pendingRef.current) {
        return
      }
      pendingRef.current = false
      clearFallback()
      setSnapshot(null)
      clearInactiveTimer()
      onActiveChange(false)
    }
    window.addEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, cancelPending)
    return () => window.removeEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, cancelPending)
  }, [clearFallback, clearInactiveTimer, onActiveChange])

  const openPicker = useCallback(() => {
    setSnapshot(contextWorktrees)
    clearInactiveTimer()
    onActiveChange(true)
    pendingRef.current = true
    clearFallback()
    fallbackTimerRef.current = window.setTimeout(flushPendingOpen, CLOSE_AUTO_FOCUS_FALLBACK_MS)
  }, [clearFallback, clearInactiveTimer, contextWorktrees, flushPendingOpen, onActiveChange])

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

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (next) {
        return
      }
      setSnapshot(null)
      // Why hold: releasing the model the instant open flips would let an Agent Map host unmount
      // the popover mid exit animation; the parent picker holds its subtree for the same reason.
      clearInactiveTimer()
      inactiveTimerRef.current = window.setTimeout(() => {
        inactiveTimerRef.current = null
        onActiveChange(false)
      }, PARENT_PICKER_EXIT_ANIMATION_MS)
    },
    [clearInactiveTimer, onActiveChange]
  )

  // Why previews: a write in flight (a folder row over a slow runtime) shows on the card through the
  // preview channel before the store changes; the row's checked swatch and its toggle must agree
  // with what the card shows, or an immediate undo picks the wrong direction.
  const contextPreviews = useWorkspaceColorTagPreviewsForWorktrees(contextWorktrees)
  const contextTags = useMemo(
    () =>
      contextWorktrees.map((item, index) => {
        const preview = contextPreviews[index]
        return preview === undefined ? item.colorTag : preview
      }),
    [contextPreviews, contextWorktrees]
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
    () => pickerTargets.map((item) => getWorkspaceColorTagIdentity(item)),
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
        onRestoreFocus={restoreMenuFocus}
      />
    )
  }
}
