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

// Why capture the content props: Escape is delivered by Radix through onEscapeKeyDown, which a DOM
// keydown cannot reach here, so the test invokes it the way Radix would.
const contentProps = vi.hoisted(() => ({
  current: null as null | {
    onEscapeKeyDown?: (event: KeyboardEvent) => void
    onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
  }
}))
vi.mock('@/components/ui/popover', () => ({
  Popover: (props: { open: boolean; children: React.ReactNode }) =>
    props.open ? <div data-testid="popover">{props.children}</div> : null,
  PopoverAnchor: (props: { children?: React.ReactNode }) => <>{props.children}</>,
  PopoverContent: (props: {
    children?: React.ReactNode
    onEscapeKeyDown?: (event: KeyboardEvent) => void
    onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
  }) => {
    contentProps.current = props
    return (
      <div data-testid="content" onKeyDown={props.onKeyDown}>
        {props.children}
      </div>
    )
  }
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

function mount(props: { colorTag: string | null; open?: boolean }) {
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
          open={props.open ?? true}
          colorTag={props.colorTag}
          menuPoint={POINT}
          previewIdentities={[IDENTITY]}
          onOpenChange={onOpenChange}
          onCommitColorTag={onCommitColorTag}
          onRestoreFocus={vi.fn()}
        />
      </>
    )
  })
  const input = container.querySelector('input') as HTMLInputElement
  const wheel = container.querySelector('[data-testid="wheel"]') as HTMLElement
  return { root, container, input, wheel, onCommitColorTag, onOpenChange }
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (
    this: HTMLInputElement,
    value: string
  ) => void
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function pressEnter(target: HTMLElement): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  )
}

describe('WorktreeColorTagPickerPopover', () => {
  let mounted: ReturnType<typeof mount> | null = null
  beforeEach(() => {
    pickerOnChange.current = null
    contentProps.current = null
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
    act(() => pressEnter(mounted!.input))

    expect(mounted.onCommitColorTag.mock.calls).toEqual([['#445566']])
    expect(latestPreview).toBeUndefined()
    expect(mounted.onOpenChange).toHaveBeenCalledWith(false)
  })

  // Regression: Enter was handled only on the input, but Radix focuses the wheel first.
  it('commits on Enter from the wheel, not only from the hex field', () => {
    mounted = mount({ colorTag: null })
    act(() => pickerOnChange.current?.('#112233'))
    act(() => pressEnter(mounted!.wheel))

    expect(mounted.onCommitColorTag.mock.calls).toEqual([['#112233']])
    expect(mounted.onOpenChange).toHaveBeenCalledWith(false)
  })

  // Regression: the untouched wheel seeds to the first swatch, and an earlier version stamped that
  // seed onto an untagged workspace the moment the popover was dismissed.
  it('commits nothing when opened and closed without a change', () => {
    mounted = mount({ colorTag: null })
    act(() => pressEnter(mounted!.input))

    expect(mounted.onCommitColorTag).not.toHaveBeenCalled()
    expect(mounted.onOpenChange).toHaveBeenCalledWith(false)
  })

  // Regression: Escape reached the same close path as leaving the popover and persisted the edit
  // the user was backing out of.
  it('backs out on Escape without committing and drops the preview', () => {
    mounted = mount({ colorTag: null })
    act(() => pickerOnChange.current?.('#112233'))
    expect(latestPreview).toBe('#112233')

    act(() => {
      contentProps.current?.onEscapeKeyDown?.(
        new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
      )
    })

    expect(mounted.onCommitColorTag).not.toHaveBeenCalled()
    expect(latestPreview).toBeUndefined()
    expect(mounted.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not forward a half-typed hex from the input', () => {
    mounted = mount({ colorTag: '#ef4444' })
    act(() => typeInto(mounted!.input, '#ab'))

    expect(mounted.onCommitColorTag).not.toHaveBeenCalled()
    expect(latestPreview).toBeUndefined()
  })

  // Regression: the popover accepted only six digits while the model accepts three, so a standard
  // `#abc` never previewed or persisted.
  it('previews a shorthand hex expanded the way the model stores it', () => {
    mounted = mount({ colorTag: null })
    act(() => typeInto(mounted!.input, '#abc'))

    expect(latestPreview).toBe('#aabbcc')
  })

  it('commits the last complete color when the field is left half-edited on close', () => {
    mounted = mount({ colorTag: null })
    act(() => pickerOnChange.current?.('#112233'))
    act(() => typeInto(mounted!.input, '#11'))
    act(() => pressEnter(mounted!.input))

    expect(mounted.onCommitColorTag.mock.calls).toEqual([['#112233']])
  })

  it('drops its preview when the card unmounts mid-drag', () => {
    mounted = mount({ colorTag: null })
    act(() => pickerOnChange.current?.('#112233'))
    expect(latestPreview).toBe('#112233')

    act(() => mounted?.root.unmount())
    mounted.container.remove()
    mounted = null
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(<PreviewProbe />))
    expect(latestPreview).toBeUndefined()
    act(() => root.unmount())
    container.remove()
  })

  // Regression: every card mounts a popover, and a closed bystander's cleanup cleared the previews
  // an open picker on another card was driving.
  it('does not let a closed bystander instance clear an open picker preview', () => {
    mounted = mount({ colorTag: null })
    act(() => pickerOnChange.current?.('#112233'))
    expect(latestPreview).toBe('#112233')

    const bystander = document.createElement('div')
    document.body.appendChild(bystander)
    const bystanderRoot = createRoot(bystander)
    act(() => {
      bystanderRoot.render(
        <WorktreeColorTagPickerPopover
          open={false}
          colorTag={null}
          menuPoint={POINT}
          previewIdentities={[IDENTITY]}
          onOpenChange={vi.fn()}
          onCommitColorTag={vi.fn()}
          onRestoreFocus={vi.fn()}
        />
      )
    })
    act(() => bystanderRoot.unmount())
    bystander.remove()

    expect(latestPreview).toBe('#112233')
  })

  // Regression: the wheel was fed the raw field text, so `#1` and `#12` made it jump or blank
  // while the user typed a replacement.
  it('keeps the wheel on the last complete color while the field holds a partial draft', () => {
    mounted = mount({ colorTag: '#ef4444' })
    act(() => typeInto(mounted!.input, '#1'))
    expect(mounted.wheel.getAttribute('data-color')).toBe('#ef4444')
    expect(mounted.input.value).toBe('#1')

    act(() => typeInto(mounted!.input, '#123456'))
    expect(mounted.wheel.getAttribute('data-color')).toBe('#123456')
  })

  it('falls back to the last wheel color, not the seed, when a typed draft goes partial', () => {
    mounted = mount({ colorTag: null })
    act(() => pickerOnChange.current?.('#112233'))
    act(() => typeInto(mounted!.input, '#a'))
    expect(mounted.wheel.getAttribute('data-color')).toBe('#112233')
  })

  it('seeds the wheel from the current tag', () => {
    mounted = mount({ colorTag: '#22c55e' })
    expect(mounted.wheel.getAttribute('data-color')).toBe('#22c55e')
  })
})
