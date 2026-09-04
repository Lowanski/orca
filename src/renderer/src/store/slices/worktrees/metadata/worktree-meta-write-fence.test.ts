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
    const { landed } = fence.begin('w', 'local')
    advanceTo(2000)
    landed()
    expect(fence.isPending('w', 'local', 1500)).toBe(true)
    expect(fence.isPending('w', 'local', 2000)).toBe(true)
  })

  it('stands down for a fetch that started after the write landed', () => {
    const { fence, advanceTo } = fenceAt(1000)
    const { landed } = fence.begin('w', 'local')
    advanceTo(2000)
    landed()
    expect(fence.isPending('w', 'local', 2001)).toBe(false)
  })

  it('is not pending after release for a caller with no listing context', () => {
    const { fence } = fenceAt(1000)
    fence.begin('w', 'local').landed()
    expect(fence.isPending('w', 'local')).toBe(false)
  })

  // Regression: a rejected write was recorded as landed, so the recovery fetch that follows a
  // failure — starting within the same millisecond — was fenced out and the failed optimistic
  // color stayed on the card with no later refresh to revert it.
  it('drops a failed write so the recovery fetch can revert the optimistic value', () => {
    const { fence } = fenceAt(1000)
    fence.begin('w', 'local').failed()
    expect(fence.isPending('w', 'local')).toBe(false)
    expect(fence.isPending('w', 'local', 1000)).toBe(false)
    expect(fence.isPending('w', 'local', 0)).toBe(false)
  })

  // Regression: HUB A and HUB B expose rows with the same id and physical host; a write for A's
  // row fenced B's refresh and replaced B's fresh tag with its stale local value.
  it('does not let a write for one HUB row fence a refresh of the sibling row', () => {
    const { fence } = fenceAt(1000)
    fence.begin('w', 'ssh:box', 'k-a')
    expect(fence.isPending('w', 'ssh:box', undefined, 'k-a')).toBe(true)
    expect(fence.isPending('w', 'ssh:box', undefined, 'k-b')).toBe(false)
  })

  it('falls back to id and host when either side has no identity', () => {
    const { fence } = fenceAt(1000)
    fence.begin('w', 'ssh:box', 'k-a')
    expect(fence.isPending('w', 'ssh:box')).toBe(true)
    const { fence: legacy } = fenceAt(1000)
    legacy.begin('w', 'ssh:box')
    expect(legacy.isPending('w', 'ssh:box', undefined, 'k-b')).toBe(true)
  })

  // Regression: before a nested-SSH row has an identity, HUB A and HUB B expose it as rows sharing
  // id and host that differ only by runtime owner; a write for A's row fenced B's refresh.
  it('does not let a write for one runtime owner fence a refresh of the sibling owner', () => {
    const { fence } = fenceAt(1000)
    fence.begin('w', 'ssh:box', undefined, 'env-a')
    expect(fence.isPending('w', 'ssh:box', undefined, undefined, 'env-a')).toBe(true)
    expect(fence.isPending('w', 'ssh:box', undefined, undefined, 'env-b')).toBe(false)
  })

  it('falls back to id and host when either side has no runtime owner', () => {
    const { fence } = fenceAt(1000)
    fence.begin('w', 'ssh:box', undefined, 'env-a')
    expect(fence.isPending('w', 'ssh:box')).toBe(true)
    const { fence: legacy } = fenceAt(1000)
    legacy.begin('w', 'ssh:box')
    expect(legacy.isPending('w', 'ssh:box', undefined, undefined, 'env-b')).toBe(true)
  })

  it('matches a host-agnostic query against a host-scoped entry and vice versa', () => {
    const { fence } = fenceAt(1000)
    fence.begin('w', 'ssh:box')
    expect(fence.isPending('w')).toBe(true)
    expect(fence.isPending('w', 'ssh:other')).toBe(false)
    expect(fence.isPending('other', 'ssh:box')).toBe(false)
  })

  // Why 120 s: a stale refresh can stay mergeable through a 30 s listing budget plus up to 30 s of
  // terminal teardown; a shorter window pruned the only guard while such a merge was still pending.
  it('keeps a released entry through the whole listing-plus-teardown pipeline', () => {
    const { fence, advanceTo } = fenceAt(1000)
    fence.begin('w', 'local').landed()
    advanceTo(1000 + 60_000)
    expect(fence.isPending('w', 'local', 0)).toBe(true)
  })

  it('forgets released entries once no live refresh could still merge', () => {
    const { fence, advanceTo } = fenceAt(1000)
    fence.begin('w', 'local').landed()
    advanceTo(1000 + 120_000 + 1)
    expect(fence.isPending('w', 'local', 0)).toBe(false)
  })
})
