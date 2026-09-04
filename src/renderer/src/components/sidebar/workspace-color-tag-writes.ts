import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { Worktree } from '../../../../shared/worktree/types'
import { getWorkspaceColorTagIdentity } from '../../../../shared/workspace-color-tag'

type WorktreeMetaWriteResult = { ok: true } | { ok: false; error: string }

/** Shape of the store's updateWorktreeMeta, narrowed to what a color write needs. */
export type WorkspaceColorTagWriter = (
  worktreeId: string,
  updates: { colorTag: string | null },
  options?: {
    executionHostId?: ExecutionHostId
    identityKey?: string
    runtimeOwnerEnvironmentId?: string
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
  /** The canonical identity this queue serves, once a row carrying one has joined it. */
  canonical: string | undefined
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
    canonical === undefined
      ? identity
      : getWorkspaceColorTagIdentity({ ...worktree, identity: undefined })
  const byFallback = queues.get(fallback)
  if (canonical !== undefined && byFallback && byFallback.canonical === undefined) {
    byFallback.canonical = canonical
    queues.set(identity, byFallback)
    return byFallback
  }
  const queue: IdentityQueue = { inFlight: false, pending: undefined, canonical }
  queues.set(identity, queue)
  if (!queues.has(fallback)) {
    queues.set(fallback, queue)
  }
  return queue
}

function drain(queue: IdentityQueue, write: WorkspaceColorTagWriter): void {
  const next = queue.pending
  queue.pending = undefined
  if (!next) {
    queue.inFlight = false
    for (const [key, registered] of queues) {
      if (registered === queue) {
        queues.delete(key)
      }
    }
    return
  }
  queue.inFlight = true
  // Why the identity: the queue is keyed by it, so the write must land on that exact row too.
  write(
    next.worktree.id,
    { colorTag: next.colorTag },
    {
      executionHostId: next.worktree.hostId ?? 'local',
      identityKey: next.worktree.identity?.key,
      // Why: a detected-only nested-SSH row has no identity yet, and its runtime owner is the only
      // thing that tells it apart from a sibling exposed by another HUB or by the desktop directly.
      runtimeOwnerEnvironmentId: next.worktree.runtimeOwnerEnvironmentId
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
