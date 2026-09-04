import { describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  assignWorkspaceColorTags,
  type WorkspaceColorTagWriter
} from './workspace-color-tag-writes'

// Why unique ids per test: the coordinator's queues are module-level on purpose (they must span
// every menu instance), so a write one test leaves in flight would stall a later test that
// reused the same identity.
function worktree(id: string, hostId?: string): Worktree {
  return { id, hostId } as unknown as Worktree
}

/** A writer whose promises the test settles by hand, in call order. */
function deferredWriter() {
  const resolvers: (() => void)[] = []
  const write = vi.fn<WorkspaceColorTagWriter>(
    () =>
      new Promise((resolve) => {
        resolvers.push(() => resolve({ ok: true }))
      })
  )
  return {
    write,
    settleNext: () => resolvers.shift()?.(),
    settleAll: () => {
      for (const resolve of resolvers.splice(0)) {
        resolve()
      }
    }
  }
}

// Why a macrotask: the landing promise sits several `.then`s deep (write -> result -> settle ->
// Promise.all -> caller), so a fixed count of awaits is brittle; a timer tick drains them all.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('assignWorkspaceColorTags', () => {
  // Regression: every card mounted its own queue, so A's menu and B's menu wrote the same
  // workspace concurrently and whichever settled last won.
  it('serializes writes to one workspace no matter which caller issued them', async () => {
    const { write, settleNext, settleAll } = deferredWriter()
    const a = worktree('serial::a')

    void assignWorkspaceColorTags([a], '#111111', write, vi.fn())
    void assignWorkspaceColorTags([a], '#222222', write, vi.fn())
    expect(write).toHaveBeenCalledTimes(1)

    settleNext()
    await flush()
    expect(write.mock.calls.map((call) => call[1])).toEqual([
      { colorTag: '#111111' },
      { colorTag: '#222222' }
    ])
    settleAll()
  })

  it('keeps the newest color per workspace when later selections overlap earlier ones', async () => {
    const { write, settleNext, settleAll } = deferredWriter()
    const [a, b, c] = [worktree('overlap::a'), worktree('overlap::b'), worktree('overlap::c')]

    void assignWorkspaceColorTags([a], '#111111', write, vi.fn())
    void assignWorkspaceColorTags([a, b], '#0000ff', write, vi.fn())
    void assignWorkspaceColorTags([a, c], '#00ff00', write, vi.fn())
    // b and c had nothing in flight, so theirs went out immediately; a is queued behind #111111.
    settleNext()
    await flush()

    const byId = new Map(write.mock.calls.map((call) => [call[0], call[1].colorTag]))
    expect(byId.get('overlap::a')).toBe('#00ff00')
    expect(byId.get('overlap::b')).toBe('#0000ff')
    expect(byId.get('overlap::c')).toBe('#00ff00')
    expect(write.mock.calls.filter((call) => call[0] === 'overlap::a')).toHaveLength(2)
    settleAll()
  })

  it('treats the same worktree id on two hosts as two independent queues', () => {
    const { write, settleAll } = deferredWriter()
    void assignWorkspaceColorTags(
      [worktree('hosts::a', 'ssh-box'), worktree('hosts::a')],
      '#111111',
      write,
      vi.fn()
    )
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls.map((call) => call[2]?.executionHostId).sort()).toEqual([
      'local',
      'ssh-box'
    ])
    settleAll()
  })

  it('keeps two runtime-scoped rows for one worktree in separate queues', () => {
    const { write, settleAll } = deferredWriter()
    const viaRuntimeA = {
      id: 'nested::w',
      hostId: 'ssh:box',
      identity: { key: 'k-a' }
    } as unknown as Worktree
    const viaRuntimeB = {
      id: 'nested::w',
      hostId: 'ssh:box',
      identity: { key: 'k-b' }
    } as unknown as Worktree
    void assignWorkspaceColorTags([viaRuntimeA, viaRuntimeB], '#111111', write, vi.fn())
    expect(write).toHaveBeenCalledTimes(2)
    settleAll()
  })

  // Regression: the picker dropped its preview the instant it closed, and a folder or queued write
  // only reaches the store when it lands, so the card snapped back for the whole round trip.
  it('resolves only after the write has landed', async () => {
    const { write, settleNext } = deferredWriter()
    let landed = false
    void assignWorkspaceColorTags([worktree('landing::a')], '#111111', write, vi.fn()).then(() => {
      landed = true
    })
    await flush()
    expect(landed).toBe(false)

    settleNext()
    await flush()
    expect(landed).toBe(true)
  })

  it('resolves a superseded assignment when the newer value lands', async () => {
    const { write, settleNext, settleAll } = deferredWriter()
    const a = worktree('supersede::a')
    let firstLanded = false
    void assignWorkspaceColorTags([a], '#111111', write, vi.fn()).then(() => {
      firstLanded = true
    })
    void assignWorkspaceColorTags([a], '#222222', write, vi.fn())
    void assignWorkspaceColorTags([a], '#333333', write, vi.fn())

    settleNext() // #111111 lands; #222222 was superseded by #333333 before it was ever written
    await flush()
    expect(firstLanded).toBe(true)
    expect(write.mock.calls.map((call) => call[1].colorTag)).toEqual(['#111111', '#333333'])
    settleAll()
  })

  it('reports a refused write once per assignment, not once per workspace', async () => {
    const write = vi.fn<WorkspaceColorTagWriter>().mockResolvedValue({
      ok: false,
      error: 'Update the remote runtime to set workspace colors'
    })
    const onError = vi.fn()
    await assignWorkspaceColorTags(
      [worktree('refused::a', 'ssh'), worktree('refused::b', 'ssh')],
      '#111111',
      write,
      onError
    )
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('Update the remote runtime to set workspace colors')
  })

  it('keeps writing after a rejected write instead of wedging the queue', async () => {
    const write = vi
      .fn<WorkspaceColorTagWriter>()
      .mockRejectedValueOnce(new Error('host away'))
      .mockResolvedValue({ ok: true })
    const a = worktree('recover::a')
    await assignWorkspaceColorTags([a], '#111111', write, vi.fn())
    await assignWorkspaceColorTags([a], '#222222', write, vi.fn())
    expect(write.mock.calls.map((call) => call[1].colorTag)).toEqual(['#111111', '#222222'])
  })
})
