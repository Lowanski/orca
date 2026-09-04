// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearWorkspaceColorTagPreviews,
  createWorkspaceColorTagPreviewOwner,
  setWorkspaceColorTagPreviews,
  useWorkspaceColorTagPreview
} from './workspace-color-tag-preview'

const IDS = ['h::a', 'h::b', 'h::c']

describe('workspace color tag preview channel', () => {
  const owner = createWorkspaceColorTagPreviewOwner()
  const other = createWorkspaceColorTagPreviewOwner()
  afterEach(() =>
    act(() => {
      clearWorkspaceColorTagPreviews(IDS, owner)
      clearWorkspaceColorTagPreviews(IDS, other)
    })
  )

  it('sets and clears every identity in the batch', () => {
    const a = renderHook(() => useWorkspaceColorTagPreview('h::a'))
    const c = renderHook(() => useWorkspaceColorTagPreview('h::c'))

    act(() => setWorkspaceColorTagPreviews(IDS, '#112233', owner))
    expect(a.result.current).toBe('#112233')
    expect(c.result.current).toBe('#112233')

    act(() => clearWorkspaceColorTagPreviews(IDS, owner))
    expect(a.result.current).toBeUndefined()
    expect(c.result.current).toBeUndefined()
  })

  it('leaves identities outside the batch alone', () => {
    const z = renderHook(() => useWorkspaceColorTagPreview('h::z'))
    act(() => setWorkspaceColorTagPreviews(IDS, '#112233', owner))
    expect(z.result.current).toBeUndefined()
  })

  it('is stable under repeated identical writes', () => {
    const a = renderHook(() => useWorkspaceColorTagPreview('h::a'))
    act(() => setWorkspaceColorTagPreviews(IDS, '#112233', owner))
    act(() => setWorkspaceColorTagPreviews(IDS, '#112233', owner))
    expect(a.result.current).toBe('#112233')
  })

  // Regression: a picker holding its preview through a slow write cleared identity-wide when the
  // write landed, erasing a newer live preview another picker had set on the same card.
  it('lets a clear remove only what its owner set', () => {
    const a = renderHook(() => useWorkspaceColorTagPreview('h::a'))
    act(() => setWorkspaceColorTagPreviews(IDS, '#111111', owner))
    act(() => setWorkspaceColorTagPreviews(IDS, '#222222', other))
    expect(a.result.current).toBe('#222222')

    act(() => clearWorkspaceColorTagPreviews(IDS, owner))
    expect(a.result.current).toBe('#222222')

    act(() => clearWorkspaceColorTagPreviews(IDS, other))
    expect(a.result.current).toBeUndefined()
  })
})
