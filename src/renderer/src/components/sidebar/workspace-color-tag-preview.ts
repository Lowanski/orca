import { useMemo, useSyncExternalStore } from 'react'

import type { Worktree } from '../../../../shared/worktree/types'
import {
  getWorkspaceColorTagFallbackIdentity,
  getWorkspaceColorTagIdentity
} from '../../../../shared/workspace-color-tag'

/**
 * Transient per-card color preview: what the custom picker shows while dragging, and what a write
 * shows while it is in flight.
 *
 * Why not the store: the store's only optimistic apply also persists, so previewing through it
 * would issue a metadata write per pointer move, and a folder workspace on a paired runtime has no
 * optimistic apply at all and can wait the full RPC timeout. This holds the color the user is
 * *looking at*; the popover commits once on close, and the write coordinator clears its entry once
 * its queue drains. Keyed by color-tag identity so the same worktree id on two hosts previews
 * independently. Nothing here is persisted or synced.
 *
 * Why owners: a picker that has closed keeps holding its preview until its write lands. If another
 * picker previews the same card in the meantime, the first one's clear must not erase the newer
 * live preview, so every entry remembers who set it and a clear only removes its own.
 */
export type WorkspaceColorTagPreviewOwner = symbol

export function createWorkspaceColorTagPreviewOwner(): WorkspaceColorTagPreviewOwner {
  return Symbol('workspace-color-tag-preview')
}

type PreviewedWorktree = Pick<Worktree, 'id' | 'hostId' | 'identity' | 'runtimeOwnerEnvironmentId'>

/** A previewed `null` is "no color", as distinct from `undefined`, "nothing previewed". */
type PreviewEntry = { colorTag: string | null; owner: WorkspaceColorTagPreviewOwner }

const previews = new Map<string, PreviewEntry>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

// Why batch: a drag fires per pointer move across every selected card, and every mounted card
// subscribes. Mutating the whole set and notifying once keeps that at one broadcast per move
// instead of selected × rendered.
export function setWorkspaceColorTagPreviews(
  identities: readonly string[],
  colorTag: string | null,
  owner: WorkspaceColorTagPreviewOwner
): void {
  let changed = false
  for (const identity of identities) {
    const entry = previews.get(identity)
    if (entry?.colorTag !== colorTag || entry.owner !== owner) {
      previews.set(identity, { colorTag, owner })
      changed = true
    }
  }
  if (changed) {
    emit()
  }
}

/** Removes only the entries this owner set; a newer preview from another picker stays. */
export function clearWorkspaceColorTagPreviews(
  identities: readonly string[],
  owner: WorkspaceColorTagPreviewOwner
): void {
  let changed = false
  for (const identity of identities) {
    if (previews.get(identity)?.owner === owner && previews.delete(identity)) {
      changed = true
    }
  }
  if (changed) {
    emit()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The previewed color for this row, or undefined when nothing is being previewed. Why two keys: a
 * background refresh can give an identity-less row its canonical identity while a picker session
 * or a queued write still previews under the old key; the card must keep seeing that preview.
 */
export function readWorkspaceColorTagPreview(
  worktree: PreviewedWorktree
): string | null | undefined {
  const canonical = previews.get(getWorkspaceColorTagIdentity(worktree))
  if (canonical) {
    return canonical.colorTag
  }
  return previews.get(getWorkspaceColorTagFallbackIdentity(worktree))?.colorTag
}

/** The previewed color for this card, or undefined when nothing is being previewed. */
export function useWorkspaceColorTagPreview(identity: string): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => previews.get(identity)?.colorTag,
    () => undefined
  )
}

export function useWorkspaceColorTagPreviewForWorktree(
  worktree: PreviewedWorktree
): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => readWorkspaceColorTagPreview(worktree),
    () => undefined
  )
}

// Why serialize: useSyncExternalStore compares snapshots by identity, so a fresh array every read
// would re-render on every broadcast; a string only changes when a previewed value does. Zero stands
// for "nothing previewed", which JSON would otherwise fold into null.
function serializePreviews(worktrees: readonly PreviewedWorktree[]): string {
  return JSON.stringify(
    worktrees.map((worktree) => {
      const preview = readWorkspaceColorTagPreview(worktree)
      return preview === undefined ? 0 : preview
    })
  )
}

/** Previewed colors for several rows at once, in order; undefined where nothing is previewed. */
export function useWorkspaceColorTagPreviewsForWorktrees(
  worktrees: readonly PreviewedWorktree[]
): readonly (string | null | undefined)[] {
  const serialized = useSyncExternalStore(
    subscribe,
    () => serializePreviews(worktrees),
    () => serializePreviews([])
  )
  return useMemo(
    () =>
      (JSON.parse(serialized) as (string | null | 0)[]).map((value) =>
        value === 0 ? undefined : value
      ),
    [serialized]
  )
}
