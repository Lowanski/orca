// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))
import type { Worktree } from '../../../../shared/worktree/types'
import { useWorktreeContextMenuCommands } from './use-worktree-context-menu-commands'

function createWorktree(id: string, hostId?: string): Worktree {
  return { id, hostId } as unknown as Worktree
}

function renderCommands(args: {
  activeContextWorktrees: readonly Worktree[]
  updateWorktreeMeta: ReturnType<typeof vi.fn>
}) {
  return renderHook(() =>
    useWorktreeContextMenuCommands({
      activeContextWorktrees: args.activeContextWorktrees,
      batchDeleteWorktrees: [],
      createGroupDialogActiveRef: { current: false },
      createProjectGroup: vi.fn(),
      folderWorkspaceId: null,
      isMultiContext: args.activeContextWorktrees.length > 1,
      moveProjectToGroup: vi.fn(),
      openModal: vi.fn(),
      repo: null,
      scopeRef: { current: null },
      setCreateGroupDialogOpen: vi.fn(),
      setMenuOpenState: vi.fn(),
      setWorktreesPinnedAndReveal: vi.fn(),
      sleepableWorktrees: [],
      subtreeSleepableWorktrees: [],
      updateWorktreeMeta: args.updateWorktreeMeta,
      validParentWorktreeId: null,
      worktree: args.activeContextWorktrees[0],
      workspaceStatuses: []
    } as never)
  )
}

describe('workspace color tag assignment', () => {
  it('tags every worktree in a multi-selection, on each one’s own execution host', () => {
    const updateWorktreeMeta = vi.fn().mockResolvedValue({ ok: true })
    const { result } = renderCommands({
      activeContextWorktrees: [
        createWorktree('repo::a', 'ssh-box'),
        createWorktree('repo::b'),
        createWorktree('repo::c', 'ssh-box')
      ],
      updateWorktreeMeta
    })

    act(() => result.current.handleAssignColorTag('#ef4444'))

    expect(updateWorktreeMeta.mock.calls).toEqual([
      ['repo::a', { colorTag: '#ef4444' }, { executionHostId: 'ssh-box' }],
      ['repo::b', { colorTag: '#ef4444' }, { executionHostId: 'local' }],
      ['repo::c', { colorTag: '#ef4444' }, { executionHostId: 'ssh-box' }]
    ])
  })

  it('writes an explicit null so clearing survives the round trip to a remote host', () => {
    const updateWorktreeMeta = vi.fn().mockResolvedValue({ ok: true })
    const { result } = renderCommands({
      activeContextWorktrees: [createWorktree('repo::a', 'ssh-box')],
      updateWorktreeMeta
    })

    act(() => result.current.handleAssignColorTag(null))

    expect(updateWorktreeMeta).toHaveBeenCalledWith(
      'repo::a',
      { colorTag: null },
      { executionHostId: 'ssh-box' }
    )
  })
})

describe('workspace color tag write coalescing', () => {
  // Why: the picker emits per pointer move. Without coalescing, a slow host could settle an
  // intermediate color after the last one the user saw.
  it('keeps one write set in flight and settles on the newest value', async () => {
    const resolvers: (() => void)[] = []
    const updateWorktreeMeta = vi.fn<
      (id: string, updates: { colorTag: string | null }) => Promise<{ ok: true }>
    >(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolvers.push(() => resolve({ ok: true }))
        })
    )
    const { result } = renderCommands({
      activeContextWorktrees: [createWorktree('repo::a')],
      updateWorktreeMeta
    })

    act(() => {
      result.current.handleAssignColorTag('#111111')
      result.current.handleAssignColorTag('#222222')
      result.current.handleAssignColorTag('#333333')
    })
    // Only the first write went out; the two later values were coalesced behind it.
    expect(updateWorktreeMeta.mock.calls.map((call) => call[1])).toEqual([{ colorTag: '#111111' }])

    await act(async () => {
      resolvers.shift()?.()
      await Promise.resolve()
    })
    // The in-flight write settled, so exactly the newest pending value follows — not the skipped one.
    expect(updateWorktreeMeta.mock.calls.map((call) => call[1])).toEqual([
      { colorTag: '#111111' },
      { colorTag: '#333333' }
    ])

    await act(async () => {
      resolvers.shift()?.()
      await Promise.resolve()
    })
    expect(updateWorktreeMeta).toHaveBeenCalledTimes(2)
  })

  it('resumes writing after a rejected write instead of wedging', async () => {
    const updateWorktreeMeta = vi
      .fn<(id: string, updates: { colorTag: string | null }) => Promise<{ ok: true }>>()
      .mockRejectedValueOnce(new Error('host away'))
      .mockResolvedValue({ ok: true })
    const { result } = renderCommands({
      activeContextWorktrees: [createWorktree('repo::a')],
      updateWorktreeMeta
    })

    act(() => result.current.handleAssignColorTag('#111111'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => result.current.handleAssignColorTag('#222222'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(updateWorktreeMeta.mock.calls.map((call) => call[1])).toEqual([
      { colorTag: '#111111' },
      { colorTag: '#222222' }
    ])
  })
})

describe('workspace color tag write coalescing: targets and errors', () => {
  // Why: the menu can reopen on a different multi-selection while a write is still out. The newer
  // color must reach the newer selection, not the targets captured when the queue started.
  it('writes each queued value to the selection that was current when it was queued', async () => {
    const resolvers: (() => void)[] = []
    const updateWorktreeMeta = vi.fn<
      (id: string, updates: { colorTag: string | null }) => Promise<{ ok: true }>
    >(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolvers.push(() => resolve({ ok: true }))
        })
    )
    const first = [createWorktree('repo::a')]
    const second = [createWorktree('repo::b'), createWorktree('repo::c')]
    const { result, rerender } = renderHook(
      ({ selection }: { selection: readonly Worktree[] }) =>
        useWorktreeContextMenuCommands({
          activeContextWorktrees: selection,
          batchDeleteWorktrees: [],
          createGroupDialogActiveRef: { current: false },
          createProjectGroup: vi.fn(),
          folderWorkspaceId: null,
          isMultiContext: selection.length > 1,
          moveProjectToGroup: vi.fn(),
          openModal: vi.fn(),
          repo: null,
          scopeRef: { current: null },
          setCreateGroupDialogOpen: vi.fn(),
          setMenuOpenState: vi.fn(),
          setWorktreesPinnedAndReveal: vi.fn(),
          sleepableWorktrees: [],
          subtreeSleepableWorktrees: [],
          updateWorktreeMeta,
          validParentWorktreeId: null,
          worktree: selection[0],
          workspaceStatuses: []
        } as never),
      { initialProps: { selection: first } }
    )

    act(() => result.current.handleAssignColorTag('#111111'))
    rerender({ selection: second })
    act(() => result.current.handleAssignColorTag('#222222'))

    await act(async () => {
      resolvers.shift()?.()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(updateWorktreeMeta.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ['repo::a', { colorTag: '#111111' }],
      ['repo::b', { colorTag: '#222222' }],
      ['repo::c', { colorTag: '#222222' }]
    ])
  })

  // Why: an older remote host is refused with { ok: false, error }. Discarding that left the
  // update-required message unseen; the only signal was the strip vanishing on the next refresh.
  it('surfaces a refused write as a toast', async () => {
    toastError.mockClear()
    const updateWorktreeMeta = vi
      .fn<(id: string, updates: { colorTag: string | null }) => Promise<unknown>>()
      .mockResolvedValueOnce({
        ok: false,
        error: 'Update the remote runtime to set workspace colors'
      })
      .mockResolvedValue({ ok: true })
    const { result } = renderCommands({
      activeContextWorktrees: [createWorktree('repo::a', 'ssh-box'), createWorktree('repo::b')],
      updateWorktreeMeta: updateWorktreeMeta as never
    })

    act(() => result.current.handleAssignColorTag('#111111'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith('Update the remote runtime to set workspace colors')
  })
})

describe('workspace color tag explicit targets', () => {
  it('writes to the given targets instead of the menu selection when provided', () => {
    const updateWorktreeMeta = vi.fn().mockResolvedValue({ ok: true })
    const { result } = renderCommands({
      activeContextWorktrees: [createWorktree('repo::a')],
      updateWorktreeMeta
    })

    act(() =>
      result.current.handleAssignColorTag('#111111', [createWorktree('repo::z', 'ssh-box')])
    )

    expect(updateWorktreeMeta).toHaveBeenCalledTimes(1)
    expect(updateWorktreeMeta).toHaveBeenCalledWith(
      'repo::z',
      { colorTag: '#111111' },
      { executionHostId: 'ssh-box' }
    )
  })
})

describe('workspace color tag coalescing across overlapping selections', () => {
  // Regression: a single pending slot let "green for A+C" replace a still-pending "blue for A+B",
  // so B's color was never written.
  it('keeps the newest color per workspace when later selections overlap earlier ones', async () => {
    const resolvers: (() => void)[] = []
    const updateWorktreeMeta = vi.fn<
      (id: string, updates: { colorTag: string | null }) => Promise<{ ok: true }>
    >(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolvers.push(() => resolve({ ok: true }))
        })
    )
    const a = createWorktree('repo::a')
    const b = createWorktree('repo::b')
    const c = createWorktree('repo::c')
    const { result } = renderCommands({ activeContextWorktrees: [a], updateWorktreeMeta })

    act(() => result.current.handleAssignColorTag('#111111', [a]))
    act(() => result.current.handleAssignColorTag('#0000ff', [a, b]))
    act(() => result.current.handleAssignColorTag('#00ff00', [a, c]))

    await act(async () => {
      resolvers.shift()?.()
      await Promise.resolve()
      await Promise.resolve()
    })

    const second = updateWorktreeMeta.mock.calls.slice(1).map((call) => [call[0], call[1]])
    expect(second).toEqual(
      expect.arrayContaining([
        ['repo::a', { colorTag: '#00ff00' }],
        ['repo::b', { colorTag: '#0000ff' }],
        ['repo::c', { colorTag: '#00ff00' }]
      ])
    )
    expect(second).toHaveLength(3)
  })

  it('treats the same worktree id on two hosts as two targets', async () => {
    const updateWorktreeMeta = vi.fn().mockResolvedValue({ ok: true })
    const { result } = renderCommands({
      activeContextWorktrees: [createWorktree('repo::a')],
      updateWorktreeMeta
    })

    act(() =>
      result.current.handleAssignColorTag('#111111', [
        createWorktree('repo::a', 'ssh-box'),
        createWorktree('repo::a')
      ])
    )

    expect(updateWorktreeMeta).toHaveBeenCalledTimes(2)
  })
})
