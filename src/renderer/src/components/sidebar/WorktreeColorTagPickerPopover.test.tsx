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
import { useWorkspaceColorTagPreview } from './workspace-color-tag-preview'

const POINT = { x: 0, y: 0 }
const IDENTITY = 'local::repo::a'

// Reads the preview channel the way the card does, so assertions cover the real consumer hook.
let latestPreview: string | undefined
function PreviewProbe(): null {
  latestPreview = useWorkspaceColorTagPreview(IDENTITY)
  return null
}

function mount(props: { colorTag: string | null }) {
  const onCommitColorTag = vi.fn()
  const onOpenChange = vi.fn()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() => {
    root.render(
      <>
        <PreviewProbe />
        <WorktreeColorTagPickerPopover
          open
          colorTag={props.colorTag}
          menuPoint={POINT}
          previewIdentities={[IDENTITY]}
          onOpenChange={onOpenChange}
          onCommitColorTag={onCommitColorTag}
        />
      </>
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

  // Why: a drag previews through the channel the card reads, and writes nothing. On a slow host a
  // per-move write would freeze the card on the first color for the whole round trip.
  it('previews every wheel change on the card without committing', () => {
    mounted = mount({ colorTag: null })
    act(() => pickerOnChange.current?.('#112233'))
    expect(latestPreview).toBe('#112233')
    act(() => pickerOnChange.current?.('#445566'))
    expect(latestPreview).toBe('#445566')

    expect(mounted.onCommitColorTag).not.toHaveBeenCalled()
  })

  it('commits the final value exactly once on Enter, clears the preview, and closes', () => {
    mounted = mount({ colorTag: null })
    act(() => pickerOnChange.current?.('#112233'))
    act(() => pickerOnChange.current?.('#445566'))
    act(() => {
      mounted?.input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      )
    })

    expect(mounted.onCommitColorTag.mock.calls).toEqual([['#445566']])
    expect(latestPreview).toBeUndefined()
    expect(mounted.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('drops its preview when the card unmounts mid-drag', () => {
    mounted = mount({ colorTag: null })
    act(() => pickerOnChange.current?.('#112233'))
    expect(latestPreview).toBe('#112233')

    act(() => mounted?.root.unmount())
    mounted.container.remove()
    mounted = null
    // Re-mount only the probe to read the channel after the popover is gone.
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(<PreviewProbe />))
    expect(latestPreview).toBeUndefined()
    act(() => root.unmount())
    container.remove()
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
