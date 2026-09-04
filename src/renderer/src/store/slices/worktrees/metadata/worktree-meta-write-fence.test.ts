import { describe, expect, it } from 'vitest'
import { MetaWriteFence } from './worktree-meta-write-fence'

function fenceAt(start: number) {
  let now = start
  const fence = new MetaWriteFence(() => now)
  return { fence, advanceTo: (t: number) => (now = t) }
}

describe('MetaWriteFence', () => {
  it('is pending while the write is in flight, for any fetch', () => {
    const { fence } = fenceAt(1000)
    fence.begin('w', 'local')
    expect(fence.isPending('w', 'local')).toBe(true)
    expect(fence.isPending('w', 'local', 5000)).toBe(true)
  })

  // Regression: releasing the moment the write settled let a fetch that had started after the
  // assignment but joined an older listing merge its stale answer once the write was done.
  it('stays armed after release for a fetch that started before the write landed', () => {
    const { fence, advanceTo } = fenceAt(1000)
    const release = fence.begin('w', 'local')
    advanceTo(2000)
    release()
    expect(fence.isPending('w', 'local', 1500)).toBe(true)
    expect(fence.isPending('w', 'local', 2000)).toBe(true)
  })

  it('stands down for a fetch that started after the write landed', () => {
    const { fence, advanceTo } = fenceAt(1000)
    const release = fence.begin('w', 'local')
    advanceTo(2000)
    release()
    expect(fence.isPending('w', 'local', 2001)).toBe(false)
  })

  it('is not pending after release for a caller with no listing context', () => {
    const { fence } = fenceAt(1000)
    fence.begin('w', 'local')()
    expect(fence.isPending('w', 'local')).toBe(false)
  })

  it('matches a host-agnostic query against a host-scoped entry and vice versa', () => {
    const { fence } = fenceAt(1000)
    fence.begin('w', 'ssh:box')
    expect(fence.isPending('w')).toBe(true)
    expect(fence.isPending('w', 'ssh:other')).toBe(false)
    expect(fence.isPending('other', 'ssh:box')).toBe(false)
  })

  it('forgets released entries once no live listing could still merge', () => {
    const { fence, advanceTo } = fenceAt(1000)
    fence.begin('w', 'local')()
    advanceTo(1000 + 30_000 + 1)
    expect(fence.isPending('w', 'local', 0)).toBe(false)
  })
})
