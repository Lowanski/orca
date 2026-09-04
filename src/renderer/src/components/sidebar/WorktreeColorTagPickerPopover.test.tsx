// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Why mock: react-colorful drives a real canvas-less DOM slider; the contract under test is what
// this popover forwards, not how the wheel computes a hue.
const pickerOnChange = vi.hoisted(() => ({ current: null as ((value: string) => void) | null }))
vi.mock('react-colorful', () => ({
  HexColorPicker: (props: { color: string; onChange: (value: string) => void }) => {
    pickerOnChange.current = props.onChange
    return <div data-testid="wheel" data-color={props.color} />
  }
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: (props: { open: boolean; children: React.ReactNode }) =>
    props.open ? <div data-testid="popover">{props.children}</div> : null,
  PopoverAnchor: (props: { children?: React.ReactNode }) => <>{props.children}</>,
  PopoverContent: (props: { children?: React.ReactNode }) => <div>{props.children}</div>
}))

import { WorktreeColorTagPickerPopover } from './WorktreeColorTagPickerPopover'

const POINT = { x: 0, y: 0 }

function mount(props: { colorTag: string | null }) {
  const onCommitColorTag = vi.fn()
  const onOpenChange = vi.fn()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() => {
    root.render(
      <WorktreeColorTagPickerPopover
        open
        colorTag={props.colorTag}
        menuPoint={POINT}
        onOpenChange={onOpenChange}
        onCommitColorTag={onCommitColorTag}
      />
    )
  })
  const input = container.querySelector('input') as HTMLInputElement
  return { root, container, input, onCommitColorTag, onOpenChange }
}

describe('WorktreeColorTagPickerPopover', () => {
  let mounted: ReturnType<typeof mount> | null = null
  beforeEach(() => {
    pickerOnChange.current = null
  })
  afterEach(() => {
    if (mounted) {
      act(() => mounted?.root.unmount())
      mounted.container.remove()
      mounted = null
    }
  })

  it('forwards every wheel change so the card previews live', () => {
    mounted = mount({ colorTag: null })
    act(() => pickerOnChange.current?.('#112233'))
    act(() => pickerOnChange.current?.('#445566'))

    expect(mounted.onCommitColorTag.mock.calls).toEqual([['#112233'], ['#445566']])
  })

  it('forwards the final value again on Enter and then closes', () => {
    mounted = mount({ colorTag: null })
    act(() => pickerOnChange.current?.('#112233'))
    act(() => {
      mounted?.input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      )
    })

    expect(mounted.onCommitColorTag).toHaveBeenLastCalledWith('#112233')
    expect(mounted.onCommitColorTag).toHaveBeenCalledTimes(2)
    expect(mounted.onOpenChange).toHaveBeenCalledWith(false)
  })

  // Regression: the untouched wheel seeds to the first swatch, and an earlier version stamped that
  // seed onto an untagged workspace the moment the popover was dismissed.
  it('commits nothing when opened and closed without a change', () => {
    mounted = mount({ colorTag: null })
    act(() => {
      mounted?.input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      )
    })

    expect(mounted.onCommitColorTag).not.toHaveBeenCalled()
    expect(mounted.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not forward a half-typed hex from the input', () => {
    mounted = mount({ colorTag: '#ef4444' })
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (
        this: HTMLInputElement,
        value: string
      ) => void
      setter.call(mounted!.input, '#ab')
      mounted?.input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(mounted.onCommitColorTag).not.toHaveBeenCalled()
  })

  it('seeds the wheel from the current tag', () => {
    mounted = mount({ colorTag: '#22c55e' })
    expect(
      mounted.container.querySelector('[data-testid="wheel"]')?.getAttribute('data-color')
    ).toBe('#22c55e')
  })
})
