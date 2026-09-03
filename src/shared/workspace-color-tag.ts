import { REPO_COLORS } from './constants'
import { normalizeHexColor } from './hex-color'

/** Swatches offered in the workspace color-tag picker. Shares the repo palette so
 *  one color language runs across the app. */
export const WORKSPACE_COLOR_TAG_SWATCHES = REPO_COLORS

/** The palette's neutral entry doubles as "no tag" — assigning it clears the tag. */
export const WORKSPACE_COLOR_TAG_NONE = REPO_COLORS[0]

/** Null means "no tag": an unparseable value and the neutral swatch both clear it. */
export function normalizeWorkspaceColorTag(value: unknown): string | null {
  const hex = normalizeHexColor(value)
  return hex === null || hex === WORKSPACE_COLOR_TAG_NONE ? null : hex
}

export function isPresetWorkspaceColorTag(value: unknown): boolean {
  const hex = normalizeWorkspaceColorTag(value)
  return hex !== null && WORKSPACE_COLOR_TAG_SWATCHES.some((swatch) => swatch === hex)
}
