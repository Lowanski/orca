import type { Worktree } from '../../../../../../shared/worktree/types'
import { isColorTagPersistencePending } from '../metadata/worktree-meta-persist'
import type { FencedWorktreeMergeArgs } from './worktree-slice-types'

export function preserveConcurrentColorTag<T extends Worktree>(
  incoming: readonly T[],
  requestStarted: readonly Worktree[] | undefined,
  current: readonly Worktree[] | undefined,
  matchesRefreshHost: (worktree: Worktree) => boolean,
  requestStartedAt?: number
): T[] {
  if (!requestStarted || !current) {
    return [...incoming]
  }
  const startedById = new Map(
    requestStarted.filter(matchesRefreshHost).map((worktree) => [worktree.id, worktree])
  )
  const currentById = new Map(
    current.filter(matchesRefreshHost).map((worktree) => [worktree.id, worktree])
  )
  return incoming.map((worktree) => {
    const started = startedById.get(worktree.id)
    const latest = currentById.get(worktree.id)
    if (!started || !latest) {
      return worktree
    }
    // Why: the maps key by path-derived id, and a checkout deleted and recreated at the same path
    // mid-refresh puts a new occupant under the old id. Its color must not be inherited from the
    // rows that described the previous occupant.
    if (!sameOccupant(worktree, started, latest)) {
      return worktree
    }
    // Why the pending guard: a fetch that started after the assignment but joined a listing
    // captured before it sees started and latest already equal to the new color, so only the
    // in-flight write tells the stale answer apart. Color writes emit no local invalidation, so
    // without this the old tag would stick until an unrelated refresh.
    if (
      isColorTagPersistencePending(
        worktree.id,
        latest.hostId,
        requestStartedAt,
        latest.identity?.key
      ) ||
      (started.colorTag ?? null) !== (latest.colorTag ?? null)
    ) {
      return { ...worktree, colorTag: latest.colorTag ?? null }
    }
    return worktree
  })
}

/** Rows without identities cannot be told apart and keep the pre-identity behaviour. */
function sameOccupant(incoming: Worktree, started: Worktree, latest: Worktree): boolean {
  const keys = [incoming.identity?.key, started.identity?.key, latest.identity?.key]
  const known = keys.filter((key): key is string => key !== undefined)
  return known.every((key) => key === known[0])
}

// The earliest moment this data could have been captured: the shared scan's start when the caller
// joined one, else the caller's own. A write that landed between the two must still be fenced.
export function fenceStartedAt(args: FencedWorktreeMergeArgs): number | undefined {
  const scan = args.refresh.startedAt
  const caller = args.requestStartedAt
  if (scan === undefined || caller === undefined) {
    return scan ?? caller
  }
  return Math.min(scan, caller)
}
