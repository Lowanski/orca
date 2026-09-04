// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearWorkspaceColorTagPreviews,
  setWorkspaceColorTagPreviews,
  useWorkspaceColorTagPreview
} from './workspace-color-tag-preview'

const IDS = ['h::a', 'h::b', 'h::c']

describe('workspace color tag preview channel', () => {
  afterEach(() => act(() => clearWorkspaceColorTagPreviews(IDS)))

  it('sets and clears every identity in the batch', () => {
    const a = renderHook(() => useWorkspaceColorTagPreview('h::a'))
    const c = renderHook(() => useWorkspaceColorTagPreview('h::c'))

    act(() => setWorkspaceColorTagPreviews(IDS, '#112233'))
    expect(a.result.current).toBe('#112233')
    expect(c.result.current).toBe('#112233')

    act(() => clearWorkspaceColorTagPreviews(IDS))
    expect(a.result.current).toBeUndefined()
    expect(c.result.current).toBeUndefined()
  })

  it('leaves identities outside the batch alone', () => {
    const other = renderHook(() => useWorkspaceColorTagPreview('h::z'))
    act(() => setWorkspaceColorTagPreviews(IDS, '#112233'))
    expect(other.result.current).toBeUndefined()
  })

  it('is stable under repeated identical writes', () => {
    const a = renderHook(() => useWorkspaceColorTagPreview('h::a'))
    act(() => setWorkspaceColorTagPreviews(IDS, '#112233'))
    act(() => setWorkspaceColorTagPreviews(IDS, '#112233'))
    expect(a.result.current).toBe('#112233')
  })
})
