import { describe, expect, it } from 'vitest'
import { fenceStartedAt } from './fetched-worktree-color-tag-fence'
import type { FencedWorktreeMergeArgs } from './worktree-slice-types'

function args(scan: number | undefined, caller: number | undefined): FencedWorktreeMergeArgs {
  return {
    refresh: { startedAt: scan },
    requestStartedAt: caller
  } as unknown as FencedWorktreeMergeArgs
}

describe('fenceStartedAt', () => {
  // Regression: a caller joining an in-flight scan stamped its own, later start, so a write that
  // landed between the scan's start and the join looked older than the fence.
  it('fences on the earlier of the scan start and the caller start', () => {
    expect(fenceStartedAt(args(500, 900))).toBe(500)
    expect(fenceStartedAt(args(900, 500))).toBe(500)
  })

  it('uses whichever is known when only one is', () => {
    expect(fenceStartedAt(args(undefined, 900))).toBe(900)
    expect(fenceStartedAt(args(500, undefined))).toBe(500)
    expect(fenceStartedAt(args(undefined, undefined))).toBeUndefined()
  })
})
