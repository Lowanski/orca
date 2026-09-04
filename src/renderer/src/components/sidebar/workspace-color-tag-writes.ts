import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  getWorkspaceColorTagFallbackIdentity,
  getWorkspaceColorTagIdentity
} from '../../../../shared/workspace-color-tag'
import {
  clearWorkspaceColorTagPreviews,
  createWorkspaceColorTagPreviewOwner,
  setWorkspaceColorTagPreviews,
  type WorkspaceColorTagPreviewOwner
} from './workspace-color-tag-preview'

type WorktreeMetaWriteResult = { ok: true } | { ok: false; error: string }

/** Shape of the store's updateWorktreeMeta, narrowed to what a color write needs. */
export type WorkspaceColorTagWriter = (
  worktreeId: string,
  updates: { colorTag: string | null },
  options?: {
    executionHostId?: ExecutionHostId
    identityKey?: string
    runtimeOwnerEnvironmentId?: string | null
  }
) => Promise<WorktreeMetaWriteResult>

type PendingWrite = {
  worktree: Worktree
  colorTag: string | null
  onError: (message: string) => void
  /** Resolvers for every assignment this value satisfies — its own and any it superseded. */
  settle: (() => void)[]
}

type IdentityQueue = {
  inFlight: boolean
  pending: PendingWrite | undefined
  /** The row carrying the canonical identity this queue serves, once one has joined it. Every later
   *  write is pinned with its identity and owner, even one queued from a copy that still lacks them. */
  canonicalRow: Worktree | undefined
  /** Every key this queue has previewed under; cleared together once the queue drains. */
  previewIdentities: Set<string>
  /**
   * Why preview from here: a folder workspace on a paired runtime has no optimistic store apply and
   * can wait the full RPC timeout, so the card would show the old strip with no feedback. The pending
   * color goes through the same channel the picker uses, and the menu row reads it too, so the toggle
   * matches what the card shows. Cleared only once the queue drains, so a superseded color never
   * flashes the old value between writes. Why one owner per queue: a checkout replaced at the same
   * path while its predecessor's write is pending gives two queues one fallback key, and the
   * predecessor's drain must not clear the successor's pending preview.
   */
  previewOwner: WorkspaceColorTagPreviewOwner
  /** The pre-identity key this queue answers to; handed to a surviving queue for the same path on drain. */
  fallbackKey: string
  /** Creation order; a draining queue hands its alias only to a newer occupant, never an older one. */
  sequence: number
}

/**
 * Color-tag write ordering, shared by every context-menu instance.
 *
 * Why module-level: each card mounts its own menu hook, so a per-hook queue lets A's menu and B's
 * menu write the same workspace concurrently and an older request that settles last wins. One
 * queue per canonical identity serializes writes to a workspace no matter which card issued
 * them; the newest pending color for that workspace is what gets written when the in-flight one
 * lands. Nothing here touches the store directly — the writer is injected.
 */
const queues = new Map<string, IdentityQueue>()
let nextQueueSequence = 0

/**
 * Assign `colorTag` to every target. Resolves once each target's write — or a newer one that
 * superseded it — has landed, so callers can hold a preview until the store reflects the change.
 * A refused or failed write is reported once per call.
 */
export function assignWorkspaceColorTags(
  targets: readonly Worktree[],
  colorTag: string | null,
  write: WorkspaceColorTagWriter,
  onError: (message: string) => void
): Promise<void> {
  let reported = false
  const reportOnce = (message: string): void => {
    if (reported) {
      return
    }
    reported = true
    onError(message)
  }
  return Promise.all(
    targets.map((worktree) => enqueue(worktree, colorTag, write, reportOnce))
  ).then(() => undefined)
}

function enqueue(
  worktree: Worktree,
  colorTag: string | null,
  write: WorkspaceColorTagWriter,
  onError: (message: string) => void
): Promise<void> {
  const current = queueFor(worktree)
  // Why both keys: a not-yet-refreshed copy of this row still reads the channel under its
  // pre-identity key, and it must show the pending color for the whole write, not the old strip.
  const previewIdentities = [
    ...new Set([
      getWorkspaceColorTagIdentity(worktree),
      getWorkspaceColorTagFallbackIdentity(worktree)
    ])
  ]
  for (const identity of previewIdentities) {
    current.previewIdentities.add(identity)
  }
  setWorkspaceColorTagPreviews(previewIdentities, colorTag, current.previewOwner)
  return new Promise<void>((resolve) => {
    // Latest wins: a newer value replaces an older pending one, and the older assignment's waiters
    // settle when the newer write lands — any later state satisfies them.
    current.pending = {
      worktree,
      colorTag,
      onError,
      settle: [...(current.pending?.settle ?? []), resolve]
    }
    if (!current.inFlight) {
      drain(current, write)
    }
  })
}

/**
 * Why two keys: a background refresh can promote an identity-less row to its canonical identity
 * while a write queued under its host-and-owner key is still in flight, and a card that has not
 * refreshed yet can still address the row without its identity. Registering the queue under both
 * keys keeps such writes in one line instead of racing two RPCs whose handlers may settle out of
 * order. A queue that already serves another identity is never adopted: two HUBs' rows for one
 * checkout share the fallback key and must stay separate.
 */
function queueFor(worktree: Worktree): IdentityQueue {
  const identity = getWorkspaceColorTagIdentity(worktree)
  const direct = queues.get(identity)
  if (direct) {
    return direct
  }
  const canonical = worktree.identity?.key
  const fallback =
    canonical === undefined ? identity : getWorkspaceColorTagFallbackIdentity(worktree)
  const byFallback = queues.get(fallback)
  if (canonical !== undefined && byFallback && byFallback.canonicalRow === undefined) {
    byFallback.canonicalRow = worktree
    queues.set(identity, byFallback)
    return byFallback
  }
  const queue: IdentityQueue = {
    inFlight: false,
    pending: undefined,
    canonicalRow: canonical === undefined ? undefined : worktree,
    previewIdentities: new Set(),
    previewOwner: createWorkspaceColorTagPreviewOwner(),
    fallbackKey: fallback,
    sequence: ++nextQueueSequence
  }
  queues.set(identity, queue)
  // Why the newest occupant owns the pre-identity key: a checkout replaced at the same path while
  // its predecessor's write is pending gives two canonical queues one fallback key, and a copy that
  // still addresses the row without an identity means the current occupant, not the one on its way
  // out. An identity-less queue is unaffected: its identity and fallback are the same string.
  queues.set(fallback, queue)
  return queue
}

function drain(queue: IdentityQueue, write: WorkspaceColorTagWriter): void {
  const next = queue.pending
  queue.pending = undefined
  if (!next) {
    queue.inFlight = false
    clearWorkspaceColorTagPreviews([...queue.previewIdentities], queue.previewOwner)
    queue.previewIdentities.clear()
    for (const [key, registered] of queues) {
      if (registered === queue) {
        queues.delete(key)
      }
    }
    // Why rebind: two occupants of one path can share the fallback key for a moment (a checkout
    // replaced while its predecessor's write is pending). Once the predecessor is gone, a copy that
    // still addresses the row without an identity must join the survivor, not open a third queue.
    // Only a newer occupant qualifies: when the replacement finishes first, its predecessor must not
    // inherit the key and pin later writes to a row on its way out.
    if (!queues.has(queue.fallbackKey)) {
      const survivor = [...new Set(queues.values())].find(
        (registered) =>
          registered.fallbackKey === queue.fallbackKey && registered.sequence > queue.sequence
      )
      if (survivor) {
        queues.set(queue.fallbackKey, survivor)
      }
    }
    return
  }
  queue.inFlight = true
  // Why the identity: the queue is keyed by it, so the write must land on that exact row too. A write
  // queued from a copy that has not refreshed yet carries no identity of its own; it takes the pin
  // from the canonical row the queue already learned, or a checkout replaced at the same path before
  // this write starts would receive it.
  const pinRow = next.worktree.identity?.key ? next.worktree : (queue.canonicalRow ?? next.worktree)
  write(
    next.worktree.id,
    { colorTag: next.colorTag },
    {
      executionHostId: next.worktree.hostId ?? 'local',
      identityKey: pinRow.identity?.key,
      // Why: a detected-only nested-SSH row has no identity yet, and its runtime owner is the only
      // thing that tells it apart from a sibling exposed by another HUB or by the desktop directly.
      // `null` says the desktop lists this row itself, so a HUB-proxied sibling with the same id and
      // host is neither recolored nor written through.
      runtimeOwnerEnvironmentId: pinRow.runtimeOwnerEnvironmentId ?? null
    }
  )
    .then(
      (result) => {
        // Why: an older remote host refuses with { ok: false }; without this the only signal is
        // the strip quietly disappearing on the next refresh.
        if (!result.ok) {
          next.onError(result.error)
        }
      },
      (error: unknown) => {
        next.onError(error instanceof Error ? error.message : String(error))
      }
    )
    .then(() => {
      for (const settle of next.settle) {
        settle()
      }
      drain(queue, write)
    })
}
