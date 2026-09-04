import { useSyncExternalStore } from 'react'

/**
 * Transient per-card color preview for the custom picker.
 *
 * Why not the store: the store's only optimistic apply also persists, so previewing through it
 * would issue a metadata write per pointer move. This holds the color the user is *looking at*
 * while dragging; the popover commits once on close. Keyed by host-qualified identity so the same
 * worktree id on two hosts previews independently. Nothing here is persisted or synced.
 */
const previews = new Map<string, string>()
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
  colorTag: string
): void {
  let changed = false
  for (const identity of identities) {
    if (previews.get(identity) !== colorTag) {
      previews.set(identity, colorTag)
      changed = true
    }
  }
  if (changed) {
    emit()
  }
}

export function clearWorkspaceColorTagPreviews(identities: readonly string[]): void {
  let changed = false
  for (const identity of identities) {
    if (previews.delete(identity)) {
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
    () => previews.get(identity),
    () => undefined
  )
}
