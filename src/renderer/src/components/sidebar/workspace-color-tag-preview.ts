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
 * Why owners, layered: a picker that has closed keeps holding its preview until its write lands, and
 * a pending write holds one too. If another picker previews the same card in the meantime, neither
 * earlier holder's clear may erase the newer live preview, and when the newer one is cleared (Escape
 * on the picker) the card must show the color still held beneath it, not the persisted strip. So
 * every row keeps one layer per owner, bottom to top, and the top layer is what the card shows.
 */
export type WorkspaceColorTagPreviewOwner = symbol

export function createWorkspaceColorTagPreviewOwner(): WorkspaceColorTagPreviewOwner {
  return Symbol('workspace-color-tag-preview')
}

type PreviewedWorktree = Pick<Worktree, 'id' | 'hostId' | 'identity' | 'runtimeOwnerEnvironmentId'>

/** A previewed `null` is "no color", as distinct from `undefined`, "nothing previewed". */
type PreviewLayer = { colorTag: string | null; owner: WorkspaceColorTagPreviewOwner }

/** Bottom to top per identity; the top layer is what the card shows. */
const previews = new Map<string, PreviewLayer[]>()
const listeners = new Set<() => void>()

function topLayer(identity: string): string | null | undefined {
  const layers = previews.get(identity)
  return layers ? layers.at(-1)?.colorTag : undefined
}

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
    const layers = previews.get(identity) ?? []
    const index = layers.findIndex((layer) => layer.owner === owner)
    const top = layers.at(-1)
    if (index === layers.length - 1 && top?.colorTag === colorTag) {
      continue
    }
    if (index !== -1) {
      layers.splice(index, 1)
    }
    layers.push({ colorTag, owner })
    previews.set(identity, layers)
    changed = true
  }
  if (changed) {
    emit()
  }
}

/** Removes only this owner's layer; whatever another holder set above or beneath it stays. */
export function clearWorkspaceColorTagPreviews(
  identities: readonly string[],
  owner: WorkspaceColorTagPreviewOwner
): void {
  let changed = false
  for (const identity of identities) {
    const layers = previews.get(identity)
    const index = layers?.findIndex((layer) => layer.owner === owner) ?? -1
    if (!layers || index === -1) {
      continue
    }
    layers.splice(index, 1)
    if (layers.length === 0) {
      previews.delete(identity)
    }
    changed = true
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
  const canonical = topLayer(getWorkspaceColorTagIdentity(worktree))
  if (canonical !== undefined) {
    return canonical
  }
  return topLayer(getWorkspaceColorTagFallbackIdentity(worktree))
}

/** The previewed color for this card, or undefined when nothing is being previewed. */
export function useWorkspaceColorTagPreview(identity: string): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => topLayer(identity),
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
