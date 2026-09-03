import { describe, expect, it } from 'vitest'
import {
  isPresetWorkspaceColorTag,
  normalizeWorkspaceColorTag,
  WORKSPACE_COLOR_TAG_NONE,
  WORKSPACE_COLOR_TAG_SWATCHES
} from './workspace-color-tag'

describe('normalizeWorkspaceColorTag', () => {
  it('expands shorthand hex and lowercases so equal colors compare equal', () => {
    expect(normalizeWorkspaceColorTag('#EF4')).toBe('#eeff44')
    expect(normalizeWorkspaceColorTag('#EF4444')).toBe('#ef4444')
    expect(normalizeWorkspaceColorTag('ef4444')).toBe('#ef4444')
    expect(normalizeWorkspaceColorTag('  #ef4444  ')).toBe('#ef4444')
  })

  it('treats the neutral swatch as "no tag" so it can clear an assigned color', () => {
    expect(normalizeWorkspaceColorTag(WORKSPACE_COLOR_TAG_NONE)).toBeNull()
    expect(normalizeWorkspaceColorTag(WORKSPACE_COLOR_TAG_NONE.toUpperCase())).toBeNull()
  })

  it('rejects values that are not a hex color', () => {
    for (const value of [
      '',
      'red',
      '#12',
      '#12345',
      '#1234567',
      'rgb(0,0,0)',
      null,
      undefined,
      42
    ]) {
      expect(normalizeWorkspaceColorTag(value)).toBeNull()
    }
  })

  it('keeps every non-neutral swatch in the palette assignable', () => {
    const assignable = WORKSPACE_COLOR_TAG_SWATCHES.filter(
      (swatch) => swatch !== WORKSPACE_COLOR_TAG_NONE
    )
    expect(assignable.length).toBeGreaterThan(0)
    for (const swatch of assignable) {
      expect(normalizeWorkspaceColorTag(swatch)).toBe(swatch)
      expect(isPresetWorkspaceColorTag(swatch)).toBe(true)
    }
  })

  it('does not report a custom color as a preset', () => {
    expect(isPresetWorkspaceColorTag('#123456')).toBe(false)
    expect(isPresetWorkspaceColorTag(WORKSPACE_COLOR_TAG_NONE)).toBe(false)
  })
})
