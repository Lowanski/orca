import type { ExecutionHostId } from '../../../../../../shared/execution-host'

type FenceEntry = {
  worktreeId: string
  executionHostId?: ExecutionHostId
  /** Null while the write is in flight; the settle time once it has landed. */
  releasedAt: number | null
}

// Why a TTL: a released entry only matters to a listing that began before the write landed, and
// a listing older than the runtime RPC timeout (15 s) can no longer merge. Doubling that keeps
// the set bounded without ever expiring an entry a live fetch could still need.
const RELEASED_ENTRY_TTL_MS = 30_000

/**
 * Tracks metadata writes so the fetched-worktree merge can tell a stale listing apart.
 *
 * Why it outlives the write promise: a fetch that starts after the optimistic write but joins a
 * listing captured before it takes its start snapshot *after* the write, so snapshot-vs-current
 * comparison sees no change and would accept the old value. Such a fetch necessarily started
 * before the write landed, so the fence stays armed for any fetch whose start precedes the release.
 */
export class MetaWriteFence {
  private readonly entries = new Set<FenceEntry>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Marks a write in flight; call the returned function once it has settled either way. */
  begin(worktreeId: string, executionHostId?: ExecutionHostId): () => void {
    this.prune()
    const entry: FenceEntry = { worktreeId, executionHostId, releasedAt: null }
    this.entries.add(entry)
    return () => {
      entry.releasedAt = this.now()
    }
  }

  /**
   * Whether a fetch must keep the current value for this workspace. Without `fetchStartedAt`
   * only an in-flight write counts, which is what a caller with no listing context should assume.
   */
  isPending(
    worktreeId: string,
    executionHostId?: ExecutionHostId,
    fetchStartedAt?: number
  ): boolean {
    this.prune()
    for (const entry of this.entries) {
      if (!matches(entry, worktreeId, executionHostId)) {
        continue
      }
      if (entry.releasedAt === null) {
        return true
      }
      if (fetchStartedAt !== undefined && fetchStartedAt <= entry.releasedAt) {
        return true
      }
    }
    return false
  }

  private prune(): void {
    const cutoff = this.now() - RELEASED_ENTRY_TTL_MS
    for (const entry of this.entries) {
      if (entry.releasedAt !== null && entry.releasedAt < cutoff) {
        this.entries.delete(entry)
      }
    }
  }
}

function matches(
  entry: FenceEntry,
  worktreeId: string,
  executionHostId?: ExecutionHostId
): boolean {
  return (
    entry.worktreeId === worktreeId &&
    (entry.executionHostId === undefined ||
      executionHostId === undefined ||
      entry.executionHostId === executionHostId)
  )
}
