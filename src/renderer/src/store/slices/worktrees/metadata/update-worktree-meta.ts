import type { WorktreeSlice } from '../../worktree-helpers'
import type { WorktreeSliceGet, WorktreeSliceSet } from '../listing/worktree-slice-types'
import { translate } from '@/i18n/i18n'
import { displayNameUpdatePinsLabel } from '../../../../../../shared/worktree/display-name-provenance'
import { parseWorkspaceKey } from '../../../../../../shared/workspace-scope'
import { applyWorktreeUpdates, getRepoIdFromWorktreeId } from '../../worktree-helpers'
import { getHostedReviewCacheKey } from '../../hosted-review-cache-identity'
import { getGitHubPRCacheKey, getLegacyGitHubPRCacheKey } from '../../github-cache-key'
import {
  applyDetectedWorktreeUpdates,
  findKnownWorktreeById,
  findPinnedWorktreeRow,
  isPinnedWorktreeMetaUpdate
} from '../listing/detected-worktree-meta'
import {
  bumpHostedReviewLinkMutationGeneration,
  hasChangedHostedReviewLinkUpdates,
  hasHostedReviewLinkUpdates
} from './hosted-review-link-mutation'
import { normalizeHostedReviewLinkReplacementUpdates } from './hosted-review-link-update-normalization'
import { persistWorktreeMeta } from './worktree-meta-persist'
import { resolvePinnedOwnerRouting } from './pinned-worktree-owner-routing'
import { refreshHostedReviewAfterMetaUpdate } from './hosted-review-refresh-after-meta-update'
import { resolveHostedReviewPushTargetUpdate } from './hosted-review-push-target-resolution'
import { updateFolderWorkspaceMeta } from './update-folder-workspace-meta'
import { isRuntimeSelectorNotFoundError } from '../listing/runtime-worktree-rpc-errors'
import { settingsForWorktreeOwner } from '../listing/worktree-owner-settings'

import { findRepoForHost } from '../../repo-host-identity'
export function createUpdateWorktreeMeta(
  set: WorktreeSliceSet,
  get: WorktreeSliceGet
): WorktreeSlice['updateWorktreeMeta'] {
  return async (requestedWorktreeId, updates, options) => {
    const shouldApplyUpdate = options?.shouldApply
    const requestedHostId = options?.executionHostId
    // Why: two paired runtimes can publish one checkout as two rows with the same id and host; a
    // caller that knows the exact row pins it, by identity or, before the row has one, by runtime
    // owner, so lookup, optimistic apply, rollback, and persistence all agree on the row.
    const requestedIdentityKey = options?.identityKey
    const requestedRuntimeOwnerEnvironmentId = options?.runtimeOwnerEnvironmentId
    const isPinned = isPinnedWorktreeMetaUpdate(options)
    const pinnedMatch = findPinnedWorktreeRow(get(), requestedWorktreeId, requestedHostId, options)
    // Why: a folder rename retires the path-derived locator while the old row is still visible; a
    // pinned write follows the identity to the row's current id so it is never persisted under
    // the retired one and never rejected as missing once the renamed row has arrived.
    let worktreeId = pinnedMatch?.id ?? requestedWorktreeId
    // Why not fall back: the locator is mutable (the row may be gone or its path reused) and local
    // persistence carries no identity, so a fallback would stamp the value on whatever occupies the
    // path now, or recreate metadata for a deleted workspace. A pinned owner whose row is gone must
    // not resolve to its sibling either.
    const identityGone = () => ({
      ok: false as const,
      error: translate(
        'auto.store.slices.worktrees.metadata.update.worktree.meta.identityGone',
        'This workspace is no longer available.'
      )
    })
    if (isPinned && !pinnedMatch) {
      return identityGone()
    }
    const existingWorktree =
      pinnedMatch ?? findKnownWorktreeById(get(), worktreeId, requestedHostId)
    const executionHostId =
      requestedHostId ??
      existingWorktree?.hostId ??
      (get().settings?.activeRuntimeEnvironmentId ? undefined : 'local')
    if (shouldApplyUpdate && !shouldApplyUpdate(existingWorktree)) {
      return { ok: true }
    }
    const workspaceScope = parseWorkspaceKey(worktreeId)
    if (workspaceScope?.type === 'folder') {
      return updateFolderWorkspaceMeta(
        get,
        workspaceScope.folderWorkspaceId,
        updates,
        executionHostId
      )
    }
    const normalizedUpdates = normalizeHostedReviewLinkReplacementUpdates(updates, existingWorktree)
    const { resolvedPushTarget, shouldClearStaleHostedReviewPushTarget } =
      await resolveHostedReviewPushTargetUpdate(
        get,
        worktreeId,
        executionHostId,
        existingWorktree,
        normalizedUpdates
      )
    // Why re-resolve: the preflight above yields, and catalog reconciliation can remove or replace
    // the pinned row meanwhile. Reusing the earlier match would let the identity-filtered reducers
    // update nothing while persistence still wrote through the mutable locator.
    const pinnedNow = findPinnedWorktreeRow(get(), worktreeId, executionHostId, options)
    if (isPinned && !pinnedNow) {
      return identityGone()
    }
    // Why adopt the new id: reconciliation can also rename the pinned row during that yield. The
    // reducers match ids exactly and local IPC rejects a retired locator, so the write follows the row.
    worktreeId = pinnedNow?.id ?? worktreeId
    const worktreeForUpdate = pinnedNow ?? get().getKnownWorktreeById(worktreeId, executionHostId)
    if (shouldApplyUpdate && !shouldApplyUpdate(worktreeForUpdate)) {
      return { ok: true }
    }
    const shouldRefreshHostedReview = Boolean(
      worktreeForUpdate && hasChangedHostedReviewLinkUpdates(normalizedUpdates, worktreeForUpdate)
    )
    const reviewRepo = shouldRefreshHostedReview
      ? (findRepoForHost(get().repos, worktreeForUpdate?.repoId ?? '', {
          hostId: executionHostId,
          settings: get().settings
        }) ?? undefined)
      : undefined
    const reviewBranch = worktreeForUpdate?.branch.replace(/^refs\/heads\//, '')

    // Why: bump lastActivityAt on comment edits so the time-decay sort doesn't drop a just-touched worktree.
    const displayNameProvenance =
      'displayName' in normalizedUpdates
        ? { displayNameIsPinned: displayNameUpdatePinsLabel(normalizedUpdates.displayName) }
        : {}
    const targetEnriched = resolvedPushTarget
      ? { ...normalizedUpdates, ...displayNameProvenance, pushTarget: resolvedPushTarget }
      : shouldClearStaleHostedReviewPushTarget
        ? { ...normalizedUpdates, ...displayNameProvenance, pushTarget: undefined }
        : { ...normalizedUpdates, ...displayNameProvenance }
    const renameCleared =
      'displayName' in targetEnriched
        ? {
            ...targetEnriched,
            pendingFirstAgentMessageRename: false,
            firstAgentMessageRenameError: null
          }
        : targetEnriched
    const enriched =
      'comment' in renameCleared ? { ...renameCleared, lastActivityAt: Date.now() } : renameCleared

    let didApply = false
    set((s) => {
      if (
        shouldApplyUpdate &&
        !shouldApplyUpdate(findKnownWorktreeById(s, worktreeId, executionHostId))
      ) {
        return {}
      }
      didApply = true
      const nextWorktrees = applyWorktreeUpdates(
        s.worktreesByRepo,
        worktreeId,
        enriched,
        executionHostId,
        requestedIdentityKey,
        requestedRuntimeOwnerEnvironmentId
      )
      const nextDetectedWorktrees = applyDetectedWorktreeUpdates(
        s.detectedWorktreesByRepo,
        worktreeId,
        enriched,
        executionHostId,
        requestedIdentityKey,
        requestedRuntimeOwnerEnvironmentId
      )
      const cacheKey =
        reviewRepo && reviewBranch
          ? getHostedReviewCacheKey(
              reviewRepo.path,
              reviewBranch,
              s.settings,
              reviewRepo.id,
              reviewRepo.connectionId,
              reviewRepo.executionHostId,
              true
            )
          : null
      const prCacheKey =
        reviewRepo && reviewBranch
          ? getGitHubPRCacheKey(
              reviewRepo.path,
              reviewRepo.id,
              reviewBranch,
              s.settings,
              reviewRepo.connectionId,
              reviewRepo.executionHostId,
              true
            )
          : null
      const prCacheKeys =
        reviewRepo && reviewBranch
          ? [
              prCacheKey,
              getLegacyGitHubPRCacheKey(reviewRepo.path, reviewRepo.id, reviewBranch),
              getLegacyGitHubPRCacheKey(reviewRepo.path, undefined, reviewBranch)
            ].filter((key): key is string => Boolean(key))
          : []
      const hostedReviewCache = s.hostedReviewCache ?? {}
      const prCache = s.prCache ?? {}
      if (
        nextWorktrees === s.worktreesByRepo &&
        nextDetectedWorktrees === s.detectedWorktreesByRepo &&
        !cacheKey &&
        !prCacheKey
      ) {
        return {}
      }

      const nextHostedReviewCache =
        cacheKey && hostedReviewCache[cacheKey]
          ? (() => {
              const next = { ...hostedReviewCache }
              delete next[cacheKey]
              return next
            })()
          : hostedReviewCache
      const nextPRCache = prCacheKeys.some((key) => prCache[key])
        ? (() => {
            const next = { ...prCache }
            for (const key of prCacheKeys) {
              delete next[key]
            }
            return next
          })()
        : prCache

      return {
        ...(nextWorktrees !== s.worktreesByRepo
          ? { worktreesByRepo: nextWorktrees, sortEpoch: s.sortEpoch + 1 }
          : {}),
        ...(nextDetectedWorktrees !== s.detectedWorktreesByRepo
          ? { detectedWorktreesByRepo: nextDetectedWorktrees }
          : {}),
        ...(nextHostedReviewCache !== hostedReviewCache
          ? { hostedReviewCache: nextHostedReviewCache }
          : {}),
        ...(nextPRCache !== prCache ? { prCache: nextPRCache } : {})
      }
    })
    if (shouldApplyUpdate && !didApply) {
      return { ok: true }
    }
    if (hasHostedReviewLinkUpdates(enriched)) {
      bumpHostedReviewLinkMutationGeneration(worktreeId)
    }

    const { pinnedSettings, recoveryFetchOptions } = resolvePinnedOwnerRouting(
      get().settings,
      requestedIdentityKey,
      worktreeForUpdate,
      executionHostId,
      requestedRuntimeOwnerEnvironmentId
    )
    // Why await and roll back: a write that failed because its host is away usually cannot refresh
    // either, and fetchWorktrees then just returns false. Left alone, the optimistic color would
    // stay on the card after the picker has already reported the failure. Scoped to colorTag: it
    // is the field this path exists for, and other fields keep their existing semantics.
    const priorColorTag = existingWorktree?.colorTag ?? null
    const recoverAfterFailedPersist = async (): Promise<void> => {
      const recovery = get()
        .fetchWorktrees(getRepoIdFromWorktreeId(worktreeId), recoveryFetchOptions)
        .catch(() => false)
      // Why branch first: only a color write needs to know whether the refresh happened, because
      // only it rolls back locally. Every other field keeps its original background reconciliation
      // instead of waiting out a second remote-listing timeout before reporting its own failure.
      if (!('colorTag' in enriched)) {
        void recovery
        return
      }
      if (await recovery) {
        return
      }
      set((s) => ({
        worktreesByRepo: applyWorktreeUpdates(
          s.worktreesByRepo,
          worktreeId,
          { colorTag: priorColorTag },
          executionHostId,
          requestedIdentityKey,
          requestedRuntimeOwnerEnvironmentId
        ),
        detectedWorktreesByRepo: applyDetectedWorktreeUpdates(
          s.detectedWorktreesByRepo,
          worktreeId,
          { colorTag: priorColorTag },
          executionHostId,
          requestedIdentityKey,
          requestedRuntimeOwnerEnvironmentId
        )
      }))
    }
    try {
      await persistWorktreeMeta(
        pinnedSettings ?? settingsForWorktreeOwner(get(), worktreeId, executionHostId),
        worktreeId,
        enriched,
        executionHostId ?? existingWorktree?.hostId,
        requestedIdentityKey ?? worktreeForUpdate?.identity?.key,
        requestedRuntimeOwnerEnvironmentId ?? worktreeForUpdate?.runtimeOwnerEnvironmentId
      )
      refreshHostedReviewAfterMetaUpdate(get, {
        suppress: options?.suppressHostedReviewRefresh === true,
        reviewRepo,
        reviewBranch,
        repoOwnerExecutionHostId: executionHostId ?? worktreeForUpdate?.hostId,
        worktreeForUpdate,
        targetEnriched
      })
    } catch (err) {
      if (isRuntimeSelectorNotFoundError(err)) {
        await recoverAfterFailedPersist()
        return {
          ok: false,
          error: translate(
            'auto.store.slices.worktrees.c6cf133786',
            'This workspace is no longer available.'
          )
        }
      }
      console.error('Failed to update worktree meta:', err)
      await recoverAfterFailedPersist()
      // Why: the refetch above reverts the optimistic write, so a caller that
      // closes its surface on this path shows the user a save that undid itself.
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    return { ok: true }
  }
}
