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

type IdentityQueue = { inFlight: boolean; pending: PendingWrite | undefined }

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
  const identity = getWorkspaceColorTagIdentity(worktree)
  let queue = queues.get(identity)
  if (!queue) {
    queue = { inFlight: false, pending: undefined }
    queues.set(identity, queue)
  }
  const current = queue
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
      drain(identity, current, write)
    }
  })
}

function drain(identity: string, queue: IdentityQueue, write: WorkspaceColorTagWriter): void {
  const next = queue.pending
  queue.pending = undefined
  if (!next) {
    queue.inFlight = false
    queues.delete(identity)
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
      drain(identity, queue, write)
    })
}
