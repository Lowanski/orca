import type { ExecutionHostId } from '../../../../../../shared/execution-host'

type FenceEntry = {
  worktreeId: string
  executionHostId?: ExecutionHostId
  /** Canonical row identity when the writer knew it; lets two HUBs' rows for one checkout differ. */
  identityKey?: string
  /** Null while the write is in flight; the settle time once it has landed. */
  releasedAt: number | null
}

// Why this bound: a released entry only matters to a refresh that began before the write landed,
// and such a refresh can still be mergeable for the whole pipeline — a listing budget of up to 30 s
// (local) or 15 s (runtime RPC), then up to 30 s of best-effort terminal teardown before the merge
// runs. Doubling that worst case keeps the set bounded without expiring an entry a still-pending
// stale merge could need.
const RELEASED_ENTRY_TTL_MS = 120_000

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

  /**
   * Marks a write in flight. Call `landed` once the host has it, or `failed` if it never got
   * there: a failed write is dropped outright, because the recovery fetch that follows a failure
   * must be free to revert the optimistic value it would otherwise be fenced out of.
   */
  begin(
    worktreeId: string,
    executionHostId?: ExecutionHostId,
    identityKey?: string
  ): { landed: () => void; failed: () => void } {
    this.prune()
    const entry: FenceEntry = { worktreeId, executionHostId, identityKey, releasedAt: null }
    this.entries.add(entry)
    return {
      landed: () => {
        entry.releasedAt = this.now()
      },
      failed: () => {
        this.entries.delete(entry)
      }
    }
  }

  /**
   * Whether a fetch must keep the current value for this workspace. Without `fetchStartedAt`
   * only an in-flight write counts, which is what a caller with no listing context should assume.
   */
  isPending(
    worktreeId: string,
    executionHostId?: ExecutionHostId,
    fetchStartedAt?: number,
    identityKey?: string
  ): boolean {
    this.prune()
    for (const entry of this.entries) {
      if (!matches(entry, worktreeId, executionHostId, identityKey)) {
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

// Why identity wins when both sides have one: two HUBs can publish one checkout as rows sharing id
// and physical host, and a write for one must not fence the other's refresh. A side without an
// identity falls back to id and host, as before.
function matches(
  entry: FenceEntry,
  worktreeId: string,
  executionHostId?: ExecutionHostId,
  identityKey?: string
): boolean {
  if (entry.worktreeId !== worktreeId) {
    return false
  }
  if (entry.identityKey !== undefined && identityKey !== undefined) {
    return entry.identityKey === identityKey
  }
  return (
    entry.executionHostId === undefined ||
    executionHostId === undefined ||
    entry.executionHostId === executionHostId
  )
}
