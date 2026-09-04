import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { preserveConcurrentColorTag } from './fetched-worktree-merge'

function worktree(id: string, colorTag: string | null | undefined): Worktree {
  return { id, hostId: 'local', colorTag } as unknown as Worktree
}
const anyHost = (): boolean => true

describe('preserveConcurrentColorTag', () => {
  // Regression: a refresh that began before a color was assigned answered with the old tag, and
  // since color writes emit no local invalidation the stale answer stuck until an unrelated refresh.
  it('keeps a color assigned while the refresh was in flight', () => {
    const merged = preserveConcurrentColorTag(
      [worktree('a', null)],
      [worktree('a', null)],
      [worktree('a', '#ef4444')],
      anyHost
    )
    expect(merged[0]?.colorTag).toBe('#ef4444')
  })

  it('keeps a clear performed while the refresh was in flight', () => {
    const merged = preserveConcurrentColorTag(
      [worktree('a', '#ef4444')],
      [worktree('a', '#ef4444')],
      [worktree('a', null)],
      anyHost
    )
    expect(merged[0]?.colorTag).toBeNull()
  })

  it('accepts the refreshed color when nothing changed locally during the fetch', () => {
    const merged = preserveConcurrentColorTag(
      [worktree('a', '#22c55e')],
      [worktree('a', '#ef4444')],
      [worktree('a', '#ef4444')],
      anyHost
    )
    expect(merged[0]?.colorTag).toBe('#22c55e')
  })

  it('treats undefined and null as the same untagged state', () => {
    const merged = preserveConcurrentColorTag(
      [worktree('a', '#22c55e')],
      [worktree('a', undefined)],
      [worktree('a', null)],
      anyHost
    )
    expect(merged[0]?.colorTag).toBe('#22c55e')
  })

  it('leaves worktrees outside the refreshed host alone', () => {
    const merged = preserveConcurrentColorTag(
      [worktree('a', null)],
      [worktree('a', null)],
      [worktree('a', '#ef4444')],
      () => false
    )
    expect(merged[0]?.colorTag).toBeNull()
  })

  it('passes incoming through untouched without a start snapshot', () => {
    const incoming = [worktree('a', null)]
    expect(
      preserveConcurrentColorTag(incoming, undefined, [worktree('a', '#ef4444')], anyHost)
    ).toEqual(incoming)
  })
})
