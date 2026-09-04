import React, { useCallback, useEffect, useRef, useState } from 'react'
import { HexColorPicker } from 'react-colorful'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import {
  normalizeWorkspaceColorTag,
  WORKSPACE_COLOR_TAG_SWATCHES
} from '../../../../shared/workspace-color-tag'
import {
  clearWorkspaceColorTagPreviews,
  setWorkspaceColorTagPreviews
} from './workspace-color-tag-preview'

const SEED_COLOR = WORKSPACE_COLOR_TAG_SWATCHES[0]

type WorktreeColorTagPickerPopoverProps = {
  open: boolean
  colorTag: string | null
  /** Right-click point inside the card's relative scope, so the picker lands where the menu was. */
  menuPoint: { x: number; y: number }
  /** Host-qualified identities of every card the picker is previewing for. */
  previewIdentities: readonly string[]
  onOpenChange: (open: boolean) => void
  /** Resolves once the write has landed in the store; the preview is held until then. */
  onCommitColorTag: (colorTag: string | null) => Promise<void>
  /** Runs as the popover closes; hands focus back to the sidebar the way the menu does. */
  onRestoreFocus: (event: Event) => void
}

type WorktreeColorTagPickerFieldsProps = {
  initialColor: string
  previewIdentities: readonly string[]
  /** The last complete color the card was shown; the popover commits this on close. */
  lastValidRef: React.MutableRefObject<string | null>
  onCommit: () => void
}

/**
 * The wheel and hex field. Mounted fresh on every open — Radix unmounts popover content on close —
 * so the draft starts from the current tag without any reset-on-prop-change effect.
 */
function WorktreeColorTagPickerFields({
  initialColor,
  previewIdentities,
  lastValidRef,
  onCommit
}: WorktreeColorTagPickerFieldsProps): React.JSX.Element {
  // draft is whatever the field holds, complete or not; lastValid is the color the card is showing.
  // Why keep both: the wheel and the commit must never see a half-typed `#1`, but the field must
  // still echo exactly what the user typed. An untouched open leaves lastValid null so the seed is
  // never stamped onto an untagged workspace.
  const [draft, setDraft] = useState(initialColor)
  const [lastValid, setLastValid] = useState<string | null>(null)

  useEffect(() => {
    lastValidRef.current = null
  }, [lastValidRef])

  const preview = useCallback(
    (value: string) => {
      setDraft(value)
      // Why the shared normalizer: it is the model's own definition of a complete color, so `#abc`
      // previews exactly as it would persist while a half-typed `#ab` does not.
      const normalized = normalizeWorkspaceColorTag(value)
      if (!normalized) {
        return
      }
      setLastValid(normalized)
      lastValidRef.current = normalized
      setWorkspaceColorTagPreviews(previewIdentities, normalized)
    },
    [lastValidRef, previewIdentities]
  )

  // The wheel only ever renders a complete color: the draft if it parses, else the last one that did.
  const wheelColor = normalizeWorkspaceColorTag(draft) ?? lastValid ?? initialColor

  return (
    // Why here: Radix focuses the wheel first, and a keyboard user who just set a hue with the
    // arrows expects Enter to commit from there, not only from the field.
    <div
      className="space-y-2"
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onCommit()
        }
      }}
    >
      <HexColorPicker color={wheelColor} onChange={preview} />
      <Input
        value={draft}
        onChange={(event) => preview(event.target.value)}
        aria-label={translate('auto.components.sidebar.WorktreeColorTagMenuItems.hex', 'Hex color')}
        className="h-7 w-full text-xs"
      />
    </div>
  )
}

/**
 * Custom-color surface for the workspace color tag. A Popover rather than a menu submenu so the
 * hex field and the picker's own arrow-key handling are actually reachable — a Radix menu manages
 * its own focus and swallows Tab, leaving non-item content keyboard-dead.
 *
 * Every change previews on the card through a transient channel — no metadata write per move.
 * Leaving the popover or pressing Enter commits the last complete color once; Escape backs out and
 * the card returns to its persisted color.
 */
export function WorktreeColorTagPickerPopover({
  open,
  colorTag,
  menuPoint,
  previewIdentities,
  onOpenChange,
  onCommitColorTag,
  onRestoreFocus
}: WorktreeColorTagPickerPopoverProps): React.JSX.Element {
  const lastValidRef = useRef<string | null>(null)
  // Why: a folder or queued write reaches the store only when it lands. Dropping the preview the
  // instant the popover closes made the card snap back to its old strip for the whole round trip.
  const committingRef = useRef(false)

  const clearPreviews = useCallback(
    () => clearWorkspaceColorTagPreviews(previewIdentities),
    [previewIdentities]
  )

  // Why gate on open: every card mounts one of these. A closed bystander that unmounts — the list
  // is virtualized — must not clear the previews an open picker on another card is driving. A
  // close that is committing keeps its preview until the write lands.
  useEffect(() => {
    if (!open) {
      return undefined
    }
    return () => {
      if (!committingRef.current) {
        clearPreviews()
      }
    }
  }, [clearPreviews, open])

  const commitAndClose = useCallback(() => {
    const colorTag = lastValidRef.current
    if (colorTag) {
      committingRef.current = true
      // Why swallow: the coordinator reports failures itself; here a rejection only means the
      // preview should stop being held, and letting it escape would surface as an unhandled error.
      void onCommitColorTag(colorTag)
        .catch(() => undefined)
        .finally(() => {
          committingRef.current = false
          clearPreviews()
        })
    } else {
      clearPreviews()
    }
    onOpenChange(false)
  }, [clearPreviews, onCommitColorTag, onOpenChange])

  // Why: Escape backs out. The draft is dropped and nothing is written.
  const cancel = useCallback(() => {
    clearPreviews()
    onOpenChange(false)
  }, [clearPreviews, onOpenChange])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpenChange(true)
          return
        }
        commitAndClose()
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
        className="w-auto p-2"
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          cancel()
        }}
        onCloseAutoFocus={onRestoreFocus}
      >
        <WorktreeColorTagPickerFields
          initialColor={colorTag ?? SEED_COLOR}
          previewIdentities={previewIdentities}
          lastValidRef={lastValidRef}
          onCommit={commitAndClose}
        />
      </PopoverContent>
    </Popover>
  )
}
