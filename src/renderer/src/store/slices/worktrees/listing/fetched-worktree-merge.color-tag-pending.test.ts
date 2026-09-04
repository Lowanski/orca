import { describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../../../../../shared/worktree/types'

// Why mock: the fence is fed by real persistence; here the question is only what the merge does
// with its answer. This stand-in reports a write that landed at t=1000.
vi.mock('../metadata/worktree-meta-persist', () => ({
  isColorTagPersistencePending: (_id: string, _host: string | undefined, fetchStartedAt?: number) =>
    fetchStartedAt !== undefined && fetchStartedAt <= 1000,
  isDisplayNamePersistencePending: () => false
}))

import { preserveConcurrentColorTag } from './fetched-worktree-color-tag-fence'

function worktree(id: string, colorTag: string | null): Worktree {
  return { id, hostId: 'local', colorTag } as unknown as Worktree
}
const anyHost = (): boolean => true
// The snapshot already carries the new color: a fetch that started after the assignment but
// joined a listing captured before it.
const startedAfterWrite = [worktree('a', '#ef4444')]
const current = [worktree('a', '#ef4444')]
const staleIncoming = [worktree('a', null)]

describe('preserveConcurrentColorTag against a write that landed at t=1000', () => {
  // Regression: the fence released the moment the write settled, so this fetch — start snapshot
  // equal to current — judged "nothing changed" and let the stale answer restore the old tag.
  it('keeps the current color for a fetch that started before the write landed', () => {
    const merged = preserveConcurrentColorTag(
      staleIncoming,
      startedAfterWrite,
      current,
      anyHost,
      900
    )
    expect(merged[0]?.colorTag).toBe('#ef4444')
  })

  it('accepts the refreshed value for a fetch that started after the write landed', () => {
    const merged = preserveConcurrentColorTag(
      staleIncoming,
      startedAfterWrite,
      current,
      anyHost,
      1100
    )
    expect(merged[0]?.colorTag).toBeNull()
  })

  it('still honours a plain snapshot-vs-current difference without a start time', () => {
    const merged = preserveConcurrentColorTag(
      staleIncoming,
      [worktree('a', null)],
      current,
      anyHost
    )
    expect(merged[0]?.colorTag).toBe('#ef4444')
  })
})
