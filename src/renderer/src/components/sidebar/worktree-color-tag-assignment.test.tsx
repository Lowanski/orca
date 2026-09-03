// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
