import { describe, expect, it } from 'vitest'
import { DEFAULT_REPO_BADGE_COLOR } from './constants'
import {
  isPresetWorkspaceColorTag,
  normalizeWorkspaceColorTag,
  resolveWorkspaceColorTagSelection,
  WORKSPACE_COLOR_TAG_SWATCHES
} from './workspace-color-tag'

describe('normalizeWorkspaceColorTag', () => {
  it('expands shorthand hex and lowercases so equal colors compare equal', () => {
    expect(normalizeWorkspaceColorTag('#EF4')).toBe('#eeff44')
    expect(normalizeWorkspaceColorTag('#EF4444')).toBe('#ef4444')
    expect(normalizeWorkspaceColorTag('ef4444')).toBe('#ef4444')
    expect(normalizeWorkspaceColorTag('  #ef4444  ')).toBe('#ef4444')
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
})

describe('WORKSPACE_COLOR_TAG_SWATCHES', () => {
  it('omits neutral, because "no tag" is its own affordance rather than a gray color', () => {
    expect(WORKSPACE_COLOR_TAG_SWATCHES).not.toContain(DEFAULT_REPO_BADGE_COLOR)
    expect(WORKSPACE_COLOR_TAG_SWATCHES.length).toBeGreaterThan(0)
  })

  it('keeps every offered swatch assignable', () => {
    for (const swatch of WORKSPACE_COLOR_TAG_SWATCHES) {
      expect(normalizeWorkspaceColorTag(swatch)).toBe(swatch)
      expect(isPresetWorkspaceColorTag(swatch)).toBe(true)
    }
  })

  it('does not report a custom color as a preset', () => {
    expect(isPresetWorkspaceColorTag('#123456')).toBe(false)
    expect(isPresetWorkspaceColorTag(DEFAULT_REPO_BADGE_COLOR)).toBe(false)
  })
})

describe('resolveWorkspaceColorTagSelection', () => {
  it('clears the tag when the workspace already carries the picked color', () => {
    expect(resolveWorkspaceColorTagSelection('#ef4444', '#ef4444')).toBeNull()
  })

  it('compares normalized values, so shorthand and case still toggle off', () => {
    expect(resolveWorkspaceColorTagSelection('#ef4444', '#EF4444')).toBeNull()
    expect(resolveWorkspaceColorTagSelection('#ffffff', '#FFF')).toBeNull()
  })

  it('replaces the tag when a different color is picked', () => {
    expect(resolveWorkspaceColorTagSelection('#ef4444', '#22c55e')).toBe('#22c55e')
    expect(resolveWorkspaceColorTagSelection(null, '#22c55e')).toBe('#22c55e')
  })

  it('stays cleared when the "no color" slot is picked', () => {
    expect(resolveWorkspaceColorTagSelection('#ef4444', null)).toBeNull()
    expect(resolveWorkspaceColorTagSelection(null, null)).toBeNull()
  })
})
