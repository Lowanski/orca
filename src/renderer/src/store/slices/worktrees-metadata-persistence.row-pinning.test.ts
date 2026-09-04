import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../types'
import { toRuntimeExecutionHostId } from '../../../../shared/execution-host'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { makeFolderWorkspace, makeWorktree } from './worktrees-slice-test-fixtures'
import {
  createTestStore,
  mockApi,
  resetRemoteRuntimeMocks,
  resetWorktreeSliceModuleMemory,
  runtimeEnvironmentCall
} from './worktrees-slice-test-harness'

// Why mock: failure paths may toast; the assertions here are on store state and on what was written.
vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }
}))

beforeEach(resetWorktreeSliceModuleMemory)

describe('runtime-owner-scoped writes for identity-less rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRemoteRuntimeMocks()
  })

  // Regression: a detected-only nested-SSH row has no canonical identity; addressed by id and host
  // alone, the optimistic apply hit its sibling from another HUB and persistence could route to the
  // desktop or the wrong HUB.
  it('applies to and persists through the named runtime owner only', async () => {
    const store = createTestStore()
    const shared = makeWorktree({
      id: 'repo1::/srv/nested',
      repoId: 'repo1',
      path: '/srv/nested',
      colorTag: null
    })
    const viaA = { ...shared, runtimeOwnerEnvironmentId: 'env-a' }
    const viaB = { ...shared, runtimeOwnerEnvironmentId: 'env-b' }
    runtimeEnvironmentCall.mockResolvedValue({
      id: 'rpc-set',
      ok: true,
      result: { worktree: { ...viaB, colorTag: '#ef4444' } },
      _meta: { runtimeId: 'runtime-b' }
    })
    store.setState({
      settings: { activeRuntimeEnvironmentId: 'env-a' } as never,
      worktreesByRepo: { repo1: [viaA, viaB] }
    } as Partial<AppState>)

    await store
      .getState()
      .updateWorktreeMeta(
        shared.id,
        { colorTag: '#ef4444' },
        { runtimeOwnerEnvironmentId: 'env-b' }
      )

    expect(store.getState().worktreesByRepo.repo1.map((worktree) => worktree.colorTag)).toEqual([
      null,
      '#ef4444'
    ])
    expect(mockApi.worktrees.updateMeta).not.toHaveBeenCalled()
    expect(runtimeEnvironmentCall).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(runtimeEnvironmentCall.mock.calls[0])).toContain('env-b')
  })

  // Regression: the prior color came from an id-and-host lookup that could land on the sibling row
  // or on nothing, so a failed write whose recovery could not run rolled the selected row back to
  // the sibling's color or cleared it outright.
  it("rolls a failed write back to the owner's own prior color", async () => {
    const store = createTestStore()
    const shared = makeWorktree({ id: 'repo1::/srv/nested', repoId: 'repo1', path: '/srv/nested' })
    const viaA = { ...shared, runtimeOwnerEnvironmentId: 'env-a', colorTag: '#ef4444' }
    const viaB = { ...shared, runtimeOwnerEnvironmentId: 'env-b', colorTag: '#3b82f6' }
    runtimeEnvironmentCall.mockRejectedValue(new Error('host away'))
    store.setState({
      settings: { activeRuntimeEnvironmentId: 'env-a' } as never,
      worktreesByRepo: { repo1: [viaA, viaB] },
      fetchWorktrees: vi.fn().mockResolvedValue(false)
    } as unknown as Partial<AppState>)

    const result = await store
      .getState()
      .updateWorktreeMeta(
        shared.id,
        { colorTag: '#22c55e' },
        { runtimeOwnerEnvironmentId: 'env-b' }
      )

    expect(result.ok).toBe(false)
    expect(store.getState().worktreesByRepo.repo1.map((worktree) => worktree.colorTag)).toEqual([
      '#ef4444',
      '#3b82f6'
    ])
  })

  it('reports not-found rather than touching the sibling when the owner has no such row', async () => {
    const store = createTestStore()
    const viaA = {
      ...makeWorktree({
        id: 'repo1::/srv/nested',
        repoId: 'repo1',
        path: '/srv/nested',
        colorTag: null
      }),
      runtimeOwnerEnvironmentId: 'env-a'
    }
    store.setState({
      settings: { activeRuntimeEnvironmentId: 'env-a' } as never,
      worktreesByRepo: { repo1: [viaA] }
    } as Partial<AppState>)

    const result = await store
      .getState()
      .updateWorktreeMeta(viaA.id, { colorTag: '#ef4444' }, { runtimeOwnerEnvironmentId: 'env-b' })

    expect(result.ok).toBe(false)
    expect(store.getState().worktreesByRepo.repo1[0]?.colorTag).toBeNull()
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
    expect(mockApi.worktrees.updateMeta).not.toHaveBeenCalled()
  })
})

describe('runtime-owner pins on folder workspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRemoteRuntimeMocks()
  })

  // Regression: the folder projection carries its paired runtime as owner, the color writer
  // forwards it as a pin, and the pinned lookup searched only the git catalogs, so every color
  // write to a runtime-owned folder workspace was rejected as "no longer available".
  it('colors a folder workspace owned by a paired runtime through the folder route', async () => {
    const store = createTestStore()
    const hostId = toRuntimeExecutionHostId('env-b')
    const folder = makeFolderWorkspace({ id: 'folder-b', executionHostId: hostId, colorTag: null })
    const updateFolderWorkspace = vi.fn().mockResolvedValue(true)
    store.setState({
      settings: { activeRuntimeEnvironmentId: 'env-a' } as never,
      folderWorkspaces: [folder],
      updateFolderWorkspace
    } as unknown as Partial<AppState>)

    const result = await store
      .getState()
      .updateWorktreeMeta(
        folderWorkspaceKey(folder.id),
        { colorTag: '#ef4444' },
        { executionHostId: hostId, runtimeOwnerEnvironmentId: 'env-b' }
      )

    expect(result.ok).toBe(true)
    expect(updateFolderWorkspace).toHaveBeenCalledWith(
      'folder-b',
      { colorTag: '#ef4444' },
      { executionHostId: hostId }
    )
  })

  it('still reports not-found for a folder pinned to an owner it no longer has', async () => {
    const store = createTestStore()
    const folder = makeFolderWorkspace({
      id: 'folder-b',
      executionHostId: toRuntimeExecutionHostId('env-b'),
      colorTag: null
    })
    const updateFolderWorkspace = vi.fn().mockResolvedValue(true)
    store.setState({
      folderWorkspaces: [folder],
      updateFolderWorkspace
    } as unknown as Partial<AppState>)

    const result = await store
      .getState()
      .updateWorktreeMeta(
        folderWorkspaceKey(folder.id),
        { colorTag: '#ef4444' },
        { runtimeOwnerEnvironmentId: 'env-c' }
      )

    expect(result.ok).toBe(false)
    expect(updateFolderWorkspace).not.toHaveBeenCalled()
  })
})

describe('pinned identity over local IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRemoteRuntimeMocks()
  })

  // Regression: local persistence dropped the pinned identity, so main could not tell that the
  // occupant had changed between the renderer's lookup and the write.
  it('forwards the pinned identity so main can validate the occupant', async () => {
    const store = createTestStore()
    const row = makeWorktree({
      id: 'repo1::/path/pinned',
      repoId: 'repo1',
      path: '/path/pinned',
      identity: { key: 'k-pin' } as never,
      colorTag: null
    })
    store.setState({ worktreesByRepo: { repo1: [row] } } as Partial<AppState>)

    await store
      .getState()
      .updateWorktreeMeta(row.id, { colorTag: '#ef4444' }, { identityKey: 'k-pin' })

    expect(mockApi.worktrees.updateMeta).toHaveBeenCalledTimes(1)
    expect(mockApi.worktrees.updateMeta.mock.calls[0]?.[0]).toMatchObject({
      worktreeId: row.id,
      identityKey: 'k-pin'
    })
  })
})
