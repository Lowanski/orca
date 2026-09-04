import type { ExecutionHostId } from '../../../../../../shared/execution-host'

type FenceEntry = {
  worktreeId: string
  executionHostId?: ExecutionHostId
  /** Canonical row identity when the writer knew it; lets two HUBs' rows for one checkout differ. */
  identityKey?: string
  /** Runtime owner for rows that have no identity yet: the same two-HUB case before identities exist. */
  runtimeOwnerEnvironmentId?: string
  /** The value written, when the writer knows it: a listing that already shows it is not stale. */
  written?: string | null
  /** Runs once, after the write has landed, if this fence ever held a listing back. */
  onHeldListing?: () => void
  held: boolean
  reconciled: boolean
  /** Null while the write is in flight; the settle time once it has landed. */
  releasedAt: number | null
}

export type MetaWriteFenceOptions = {
  written?: string | null
  onHeldListing?: () => void
}

// Why this bound: a released entry only matters to a refresh that began before the write landed,
// and such a refresh can still be mergeable for the whole pipeline: a listing budget of up to 30 s
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
    identityKey?: string,
    runtimeOwnerEnvironmentId?: string,
    options?: MetaWriteFenceOptions
  ): { landed: () => void; failed: () => void } {
    this.prune()
    const entry: FenceEntry = {
      worktreeId,
      executionHostId,
      identityKey,
      runtimeOwnerEnvironmentId,
      written: options?.written,
      onHeldListing: options?.onHeldListing,
      held: false,
      reconciled: false,
      releasedAt: null
    }
    this.entries.add(entry)
    return {
      landed: () => {
        entry.releasedAt = this.now()
        if (entry.held) {
          reconcile(entry)
        }
      },
      failed: () => {
        this.entries.delete(entry)
      }
    }
  }

  /**
   * Whether a fetch must keep the current value for this workspace. Without `fetchStartedAt`
   * only an in-flight write counts, which is what a caller with no listing context should assume.
   * `incoming` is the value the listing carries: one that already shows the written value cannot
   * be stale with respect to that write and is never held by it.
   */
  isPending(
    worktreeId: string,
    executionHostId?: ExecutionHostId,
    fetchStartedAt?: number,
    identityKey?: string,
    runtimeOwnerEnvironmentId?: string,
    incoming?: string | null
  ): boolean {
    this.prune()
    for (const entry of this.entries) {
      if (!matches(entry, worktreeId, executionHostId, identityKey, runtimeOwnerEnvironmentId)) {
        continue
      }
      if (incoming !== undefined && entry.written !== undefined && incoming === entry.written) {
        continue
      }
      if (
        entry.releasedAt === null ||
        (fetchStartedAt !== undefined && fetchStartedAt <= entry.releasedAt)
      ) {
        hold(entry)
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

// Why reconcile: a listing that started before the write landed can still carry a *newer*
// authoritative value (a peer changed the tag after this write reached the host), and the fence
// cannot tell that from a stale listing. Holding it is the safe default; one refresh after landing
// lets the host settle the question, so the notification the peer's change produced is not lost.
function hold(entry: FenceEntry): void {
  entry.held = true
  if (entry.releasedAt !== null) {
    reconcile(entry)
  }
}

// Why deferred: the merge that asks the fence runs inside a store reducer; the refresh must start
// after that reducer has returned.
function reconcile(entry: FenceEntry): void {
  if (entry.reconciled || !entry.onHeldListing) {
    return
  }
  entry.reconciled = true
  queueMicrotask(entry.onHeldListing)
}

// Why identity wins when both sides have one, and is compared before the id: two HUBs can publish
// one checkout as rows sharing id and physical host, and a write for one must not fence the other's
// refresh; and a folder rename retires the id a write began under while the row keeps its identity,
// so a stale refresh merged under the new id must still meet the fence. Before rows have identities
// the runtime owner tells them apart. A side that knows neither falls back to id and host, as before.
function matches(
  entry: FenceEntry,
  worktreeId: string,
  executionHostId?: ExecutionHostId,
  identityKey?: string,
  runtimeOwnerEnvironmentId?: string
): boolean {
  if (entry.identityKey !== undefined && identityKey !== undefined) {
    return entry.identityKey === identityKey
  }
  if (entry.worktreeId !== worktreeId) {
    return false
  }
  if (
    entry.runtimeOwnerEnvironmentId !== undefined &&
    runtimeOwnerEnvironmentId !== undefined &&
    entry.runtimeOwnerEnvironmentId !== runtimeOwnerEnvironmentId
  ) {
    return false
  }
  return (
    entry.executionHostId === undefined ||
    executionHostId === undefined ||
    entry.executionHostId === executionHostId
  )
}
