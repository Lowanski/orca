// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../../../shared/worktree/types'
import { useWorktreeColorTagPicker } from './use-worktree-color-tag-picker'

vi.mock('./WorktreeColorTagPickerPopover', () => ({
  WorktreeColorTagPickerPopover: (props: { open: boolean }) => (
    <div data-testid="picker" data-open={props.open} />
  )
}))

function worktree(colorTag: string | null): Worktree {
  return { id: `w-${colorTag}`, colorTag } as unknown as Worktree
}

function isOpen(picker: React.JSX.Element): boolean {
  return (picker.props as { open: boolean }).open
}

const POINT = { x: 10, y: 20 }

describe('workspace color tag picker handoff', () => {
  afterEach(() => vi.useRealTimers())

  // Regression: opening in the same tick let the menu-closing click dismiss the popover, so the
  // picker flashed shut and the custom swatch looked dead.
  it('waits for the menu to tear down before opening', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(() =>
      useWorktreeColorTagPicker([worktree(null)], POINT, vi.fn())
    )

    act(() => result.current.openPicker())
    rerender()
    expect(isOpen(result.current.picker)).toBe(false)

    act(() => vi.advanceTimersByTime(50))
    rerender()
    expect(isOpen(result.current.picker)).toBe(true)
  })

  it('drops a pending open when the card unmounts mid-handoff', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() =>
      useWorktreeColorTagPicker([worktree(null)], POINT, vi.fn())
    )

    act(() => result.current.openPicker())
    unmount()
    expect(() => vi.advanceTimersByTime(50)).not.toThrow()
  })

  it('seeds the picker from a uniformly tagged selection', () => {
    const { result } = renderHook(() =>
      useWorktreeColorTagPicker([worktree('#ef4444'), worktree('#ef4444')], POINT, vi.fn())
    )
    expect(result.current.sharedColorTag).toBe('#ef4444')
  })

  it('seeds the picker as untagged when the selection is mixed', () => {
    const { result } = renderHook(() =>
      useWorktreeColorTagPicker([worktree('#ef4444'), worktree('#22c55e')], POINT, vi.fn())
    )
    expect(result.current.sharedColorTag).toBeNull()
  })
})
