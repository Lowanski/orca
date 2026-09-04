import {
  assertRuntimeEnvironmentCapability,
  callRuntimeRpc,
  getActiveRuntimeTarget,
  runtimeEnvironmentSupportsCapability
} from '../../../../runtime/runtime-rpc-client'
import {
  TASK_SOURCE_CONTEXT_RUNTIME_CAPABILITY,
  WORKSPACE_COLOR_TAG_RUNTIME_CAPABILITY,
  WORKTREE_GITHUB_PR_SUPPRESSION_RUNTIME_CAPABILITY,
  WORKTREE_LINKED_WORK_ITEM_CONTEXT_RUNTIME_CAPABILITY
} from '../../../../../../shared/protocol-version'
import { toRuntimeWorktreeSelector } from '../../../../runtime/runtime-worktree-selector'
import { translate } from '@/i18n/i18n'
import type { AppState } from '../../../types'
import type { WorktreeMeta } from '../../../../../../shared/worktree/meta-types'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import { encodePushTargetClearForRuntimeRpc } from './hosted-review-link-mutation'
import { MetaWriteFence } from './worktree-meta-write-fence'

type PendingMetaWrite = {
  worktreeId: string
  executionHostId?: ExecutionHostId
}

// Why per field: the fetched-worktree merge asks per field whether a write is still in flight so
// a refresh that joined a listing captured before the write cannot restore the old value. Color
// writes use a fence that outlives the promise (see MetaWriteFence); display names keep the
// original in-flight-only tracking.
const pendingDisplayNameWrites = new Set<PendingMetaWrite>()
const colorTagWriteFence = new MetaWriteFence()

function pendingWriteMatches(
  write: PendingMetaWrite,
  worktreeId: string,
  executionHostId?: ExecutionHostId
): boolean {
  return (
    write.worktreeId === worktreeId &&
    (write.executionHostId === undefined ||
      executionHostId === undefined ||
      write.executionHostId === executionHostId)
  )
}

function hasPendingWrite(
  writes: ReadonlySet<PendingMetaWrite>,
  worktreeId: string,
  executionHostId?: ExecutionHostId
): boolean {
  for (const write of writes) {
    if (pendingWriteMatches(write, worktreeId, executionHostId)) {
      return true
    }
  }
  return false
}

export function isDisplayNamePersistencePending(
  worktreeId: string,
  executionHostId?: ExecutionHostId
): boolean {
  return hasPendingWrite(pendingDisplayNameWrites, worktreeId, executionHostId)
}

/** Pass the fetch's start time so a listing that predates the write's landing stays fenced. */
export function isColorTagPersistencePending(
  worktreeId: string,
  executionHostId?: ExecutionHostId,
  fetchStartedAt?: number
): boolean {
  return colorTagWriteFence.isPending(worktreeId, executionHostId, fetchStartedAt)
}

export function persistWorktreeMeta(
  settings: AppState['settings'],
  worktreeId: string,
  updates: Partial<WorktreeMeta>,
  executionHostId?: ExecutionHostId,
  identityKey?: string
): Promise<void> {
  const operation = persistWorktreeMetaUntracked(
    settings,
    worktreeId,
    updates,
    executionHostId,
    identityKey
  )
  const onLanded: (() => void)[] = []
  const onFailed: (() => void)[] = []
  if ('displayName' in updates) {
    const write: PendingMetaWrite = { worktreeId, executionHostId }
    pendingDisplayNameWrites.add(write)
    const drop = (): void => {
      pendingDisplayNameWrites.delete(write)
    }
    onLanded.push(drop)
    onFailed.push(drop)
  }
  if ('colorTag' in updates) {
    const fence = colorTagWriteFence.begin(worktreeId, executionHostId)
    onLanded.push(fence.landed)
    onFailed.push(fence.failed)
  }
  if (onLanded.length === 0) {
    return operation
  }
  void operation.then(
    () => {
      for (const fn of onLanded) {
        fn()
      }
    },
    () => {
      for (const fn of onFailed) {
        fn()
      }
    }
  )
  return operation
}

async function persistWorktreeMetaUntracked(
  settings: AppState['settings'],
  worktreeId: string,
  updates: Partial<WorktreeMeta>,
  executionHostId?: ExecutionHostId,
  identityKey?: string
): Promise<void> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'local') {
    await window.api.worktrees.updateMeta({
      worktreeId,
      ...(executionHostId ? { executionHostId } : {}),
      updates
    })
    return
  }
  // Why: `worktree.set` parses in strip mode, so an older runtime drops the key
  // and applies the rest. Both gates key off presence, not value — a dropped
  // *clear* strands a stale link that the Issue row then hides.
  if (
    target.kind === 'environment' &&
    ('linkedWorkItem' in updates || 'linkedTaskSourceContext' in updates)
  ) {
    await assertRuntimeEnvironmentCapability(
      target.environmentId,
      WORKTREE_LINKED_WORK_ITEM_CONTEXT_RUNTIME_CAPABILITY,
      translate(
        'auto.store.slices.worktrees.metadata.worktree.meta.persist.877e3638d8',
        'Update the remote runtime to change this workspace’s linked issue'
      )
    )
  }
  // task-source-context.v1 is a sound proxy for the Linear keys: #5322 added them
  // to the schema and is an ancestor of the commit introducing that capability.
  if (target.kind === 'environment' && 'linkedLinearIssue' in updates) {
    await assertRuntimeEnvironmentCapability(
      target.environmentId,
      TASK_SOURCE_CONTEXT_RUNTIME_CAPABILITY,
      translate(
        'auto.store.slices.worktrees.metadata.worktree.meta.persist.4367540861',
        'Update the remote runtime to link Linear issues'
      )
    )
  }
  // Why fail loud rather than degrade: an older host strips colorTag and still reports success,
  // so a silent drop would paint the strip and let the next refresh erase it with no explanation.
  if (target.kind === 'environment' && 'colorTag' in updates) {
    await assertRuntimeEnvironmentCapability(
      target.environmentId,
      WORKSPACE_COLOR_TAG_RUNTIME_CAPABILITY,
      translate(
        'auto.store.slices.worktrees.metadata.worktree.meta.persist.colorTag',
        'Update the remote runtime to set workspace colors'
      )
    )
  }
  let compatibleUpdates = updates
  if (target.kind === 'environment' && 'suppressedGitHubPR' in updates) {
    if (typeof updates.suppressedGitHubPR === 'number' && updates.suppressedGitHubPR > 0) {
      await assertRuntimeEnvironmentCapability(
        target.environmentId,
        WORKTREE_GITHUB_PR_SUPPRESSION_RUNTIME_CAPABILITY,
        translate(
          'auto.store.slices.worktrees.metadata.worktree.meta.persist.github.pr.suppression',
          'Update the remote runtime to unlink GitHub pull requests'
        )
      )
    } else if (
      updates.suppressedGitHubPR === null &&
      !(await runtimeEnvironmentSupportsCapability(
        target.environmentId,
        WORKTREE_GITHUB_PR_SUPPRESSION_RUNTIME_CAPABILITY
      ))
    ) {
      const olderHostUpdates = { ...updates }
      delete olderHostUpdates.suppressedGitHubPR
      compatibleUpdates = olderHostUpdates
    }
  }
  await callRuntimeRpc(
    target,
    'worktree.set',
    {
      worktree: identityKey ? `identity:${identityKey}` : toRuntimeWorktreeSelector(worktreeId),
      ...encodePushTargetClearForRuntimeRpc(compatibleUpdates)
    },
    { timeoutMs: 15_000 }
  )
}
