import { describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../../../../../shared/worktree/types'

// Why mock: the pending tracker is fed by real persistence; here the question is only what the
// merge does when it reports a write in flight.
vi.mock('../metadata/worktree-meta-persist', () => ({
  isColorTagPersistencePending: () => true,
  isDisplayNamePersistencePending: () => false
}))

import { preserveConcurrentColorTag } from './fetched-worktree-merge'

function worktree(id: string, colorTag: string | null): Worktree {
  return { id, hostId: 'local', colorTag } as unknown as Worktree
}

describe('preserveConcurrentColorTag while a write is pending', () => {
  // Regression: a fetch that started after the assignment but joined a listing captured before it
  // saw started and latest both already at the new color, judged "nothing changed", and let the
  // stale answer restore the old tag.
  it('keeps the current color even when the start snapshot already matches it', () => {
    const merged = preserveConcurrentColorTag(
      [worktree('a', null)],
      [worktree('a', '#ef4444')],
      [worktree('a', '#ef4444')],
      () => true
    )
    expect(merged[0]?.colorTag).toBe('#ef4444')
  })
})
