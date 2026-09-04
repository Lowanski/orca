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

function render(selection: readonly Worktree[], restoreMenuFocus = vi.fn()) {
  const view = renderHook(() =>
    useWorktreeColorTagPicker(selection, POINT, vi.fn(), restoreMenuFocus)
  )
  return { ...view, restoreMenuFocus }
}

describe('workspace color tag picker handoff', () => {
  afterEach(() => vi.useRealTimers())

  // Regression: the menu plays an exit animation, so its onCloseAutoFocus lands *after* a
  // timer-opened popover. The focus restore then pulled focus out of the popover and Radix
  // dismissed it, so the custom swatch appeared to close both surfaces.
  it('suppresses the menu focus restore while a picker is pending', () => {
    vi.useFakeTimers()
    const { result, restoreMenuFocus } = render([worktree(null)])

    act(() => result.current.openPicker())
    const event = new Event('closeAutoFocus', { cancelable: true })
    act(() => result.current.handleMenuCloseAutoFocus(event))

    expect(restoreMenuFocus).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('opens only after the menu has finished tearing down', () => {
    vi.useFakeTimers()
    const { result, rerender } = render([worktree(null)])

    act(() => result.current.openPicker())
    rerender()
    expect(isOpen(result.current.picker)).toBe(false)

    act(() => result.current.handleMenuCloseAutoFocus(new Event('x', { cancelable: true })))
    act(() => vi.advanceTimersByTime(0))
    rerender()
    expect(isOpen(result.current.picker)).toBe(true)
  })

  it('still opens when the menu never reports close-auto-focus', () => {
    vi.useFakeTimers()
    const { result, rerender } = render([worktree(null)])

    act(() => result.current.openPicker())
    act(() => vi.advanceTimersByTime(250))
    rerender()
    expect(isOpen(result.current.picker)).toBe(true)
  })

  it('runs the menu focus restore normally when no picker is pending', () => {
    const { result, restoreMenuFocus } = render([worktree(null)])
    const event = new Event('x', { cancelable: true })

    act(() => result.current.handleMenuCloseAutoFocus(event))

    expect(restoreMenuFocus).toHaveBeenCalledWith(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('opens once, not twice, when the fallback and the handoff both fire', () => {
    vi.useFakeTimers()
    const { result, rerender } = render([worktree(null)])

    act(() => result.current.openPicker())
    act(() => result.current.handleMenuCloseAutoFocus(new Event('x', { cancelable: true })))
    act(() => vi.advanceTimersByTime(500))
    rerender()

    expect(isOpen(result.current.picker)).toBe(true)
  })

  it('seeds the picker from a uniformly tagged selection', () => {
    const { result } = render([worktree('#ef4444'), worktree('#ef4444')])
    expect(result.current.sharedColorTag).toBe('#ef4444')
  })

  it('seeds the picker as untagged when the selection is mixed', () => {
    const { result } = render([worktree('#ef4444'), worktree('#22c55e')])
    expect(result.current.sharedColorTag).toBeNull()
  })
})
