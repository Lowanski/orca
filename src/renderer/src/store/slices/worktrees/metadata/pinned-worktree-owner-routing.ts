import {
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { AppState } from '../../../types'
import type { findKnownWorktreeById } from '../listing/detected-worktree-meta'
import {
  settingsForDirectOwner,
  settingsForRuntimeEnvironmentOwner
} from '../listing/worktree-owner-settings'

type PinnedOwnerRouting = {
  /** Settings to persist through, or undefined to use the id-and-host owner lookup. */
  pinnedSettings: AppState['settings'] | undefined
  /** Where a recovery refetch must go after a failure, or undefined for the default. */
  recoveryFetchOptions: { executionHostId: ExecutionHostId } | undefined
}

/**
 * How an identity-pinned row reaches its host.
 *
 * Why: two paired runtimes can publish one checkout as rows sharing id and physical host, and the
 * desktop can list the same checkout directly as well. A row with a paired-runtime owner goes
 * through that runtime; a row without one is listed by the desktop itself and must not fall back
 * to the id-and-host guess, which can pick a HUB that also proxies the checkout and would reject the
 * desktop row's identity selector. Recovery after a failure follows the same owner, or the failed
 * optimistic value stays on screen.
 */
export function resolvePinnedOwnerRouting(
  settings: AppState['settings'],
  requestedIdentityKey: string | undefined,
  pinnedCandidate: ReturnType<typeof findKnownWorktreeById>,
  executionHostId: ExecutionHostId | undefined
): PinnedOwnerRouting {
  if (requestedIdentityKey === undefined || !pinnedCandidate) {
    return { pinnedSettings: undefined, recoveryFetchOptions: undefined }
  }
  const row = pinnedCandidate as Partial<Pick<Worktree, 'runtimeOwnerEnvironmentId' | 'hostId'>>
  const ownerEnvironmentId = row.runtimeOwnerEnvironmentId
  if (ownerEnvironmentId) {
    return {
      pinnedSettings: settingsForRuntimeEnvironmentOwner(settings, ownerEnvironmentId),
      recoveryFetchOptions: { executionHostId: toRuntimeExecutionHostId(ownerEnvironmentId) }
    }
  }
  const directHost = executionHostId ?? row.hostId
  return {
    pinnedSettings: settingsForDirectOwner(settings),
    recoveryFetchOptions: directHost ? { executionHostId: directHost } : undefined
  }
}
