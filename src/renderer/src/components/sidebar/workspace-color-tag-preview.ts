import { useSyncExternalStore } from 'react'

/**
 * Transient per-card color preview for the custom picker.
 *
 * Why not the store: the store's only optimistic apply also persists, so previewing through it
 * would issue a metadata write per pointer move. This holds the color the user is *looking at*
 * while dragging; the popover commits once on close. Keyed by host-qualified identity so the same
 * worktree id on two hosts previews independently. Nothing here is persisted or synced.
 *
 * Why owners: a picker that has closed keeps holding its preview until its write lands. If another
 * picker previews the same card in the meantime, the first one's clear must not erase the newer
 * live preview, so every entry remembers who set it and a clear only removes its own.
 */
export type WorkspaceColorTagPreviewOwner = symbol

export function createWorkspaceColorTagPreviewOwner(): WorkspaceColorTagPreviewOwner {
  return Symbol('workspace-color-tag-preview')
}

type PreviewEntry = { colorTag: string; owner: WorkspaceColorTagPreviewOwner }

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
  colorTag: string,
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

/** The previewed color for this card, or undefined when nothing is being previewed. */
export function useWorkspaceColorTagPreview(identity: string): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => previews.get(identity)?.colorTag,
    () => undefined
  )
}
