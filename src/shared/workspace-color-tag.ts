import { DEFAULT_REPO_BADGE_COLOR, REPO_COLORS } from './constants'
import { normalizeHexColor } from './hex-color'

/** Assignable swatches, sharing the repo palette so one color language runs across the app.
 *  Neutral is excluded: as a filled swatch it reads as a gray tag rather than as absence, so
 *  "no tag" gets its own empty affordance instead of borrowing a color. */
export const WORKSPACE_COLOR_TAG_SWATCHES: readonly string[] = REPO_COLORS.filter(
  (color) => color !== DEFAULT_REPO_BADGE_COLOR
)

/** Null means "no tag". Any value that is not a hex color clears it. */
export function normalizeWorkspaceColorTag(value: unknown): string | null {
  return normalizeHexColor(value)
}

export function isPresetWorkspaceColorTag(value: unknown): boolean {
  const hex = normalizeWorkspaceColorTag(value)
  return hex !== null && WORKSPACE_COLOR_TAG_SWATCHES.includes(hex)
}

/** Picking the tag a workspace already carries removes it, so one swatch both sets and clears. */
export function resolveWorkspaceColorTagSelection(
  current: string | null,
  chosen: string | null
): string | null {
  const normalizedChosen = normalizeWorkspaceColorTag(chosen)
  return normalizedChosen !== null && normalizedChosen === normalizeWorkspaceColorTag(current)
    ? null
    : normalizedChosen
}

/** The tag a whole selection carries, or null when it is mixed or untagged. Toggle-off must key
 *  off the selection as a whole: keying off the right-clicked workspace alone would clear a mixed
 *  selection when the user meant to unify it. */
export function getSharedWorkspaceColorTag(
  colorTags: readonly (string | null | undefined)[]
): string | null {
  if (colorTags.length === 0) {
    return null
  }
  const first = normalizeWorkspaceColorTag(colorTags[0])
  return colorTags.every((tag) => normalizeWorkspaceColorTag(tag) === first) ? first : null
}
