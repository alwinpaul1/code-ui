import { locateJsonError } from '../project-config-json-locate-error'

/**
 * `.claude/settings.json` / `.claude/settings.local.json`'s `permissions`
 * block, read and mutated without disturbing anything else in the file.
 *
 * The settings file can carry hooks, `env`, `model`, `additionalDirectories`
 * and more, none of which this screen understands or should touch. So
 * parsing keeps the whole decoded object (`ParsedPermissionSettings.settings`)
 * and every mutation here returns a shallow clone with only `.permissions`
 * (and, inside it, only the touched category array) replaced — every other
 * key, and every other key inside `permissions` itself (`defaultMode`,
 * `additionalDirectories`, …), passes through untouched. Re-serializing with
 * `JSON.stringify(settings, null, 2)` cannot reproduce a file's original
 * byte-for-byte formatting (comments are not legal JSON either way, and
 * `JSON.stringify` always re-indents), but it does preserve every key and
 * its value exactly, in its original order — "byte-for-byte where possible".
 */
export type PermissionRuleCategory = 'allow' | 'deny' | 'ask'

export const PERMISSION_RULE_CATEGORIES: readonly PermissionRuleCategory[] = ['allow', 'deny', 'ask']

export type PermissionRuleSet = Record<PermissionRuleCategory, string[]>

export type PermissionSettingsParseError = {
  line: number | null
  column: number | null
  message: string
}

export type PermissionSettingsParseResult =
  | { ok: true; settings: Record<string, unknown>; rules: PermissionRuleSet }
  | { ok: false; error: PermissionSettingsParseError }

function emptyRuleSet(): PermissionRuleSet {
  return { allow: [], deny: [], ask: [] }
}

function readRuleArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((v): v is string => typeof v === 'string')
}

function readRuleSet(permissions: unknown): PermissionRuleSet {
  if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) {
    return emptyRuleSet()
  }
  const obj = permissions as Record<string, unknown>
  return {
    allow: readRuleArray(obj.allow),
    deny: readRuleArray(obj.deny),
    ask: readRuleArray(obj.ask)
  }
}

export function parsePermissionSettings(source: string): PermissionSettingsParseResult {
  const trimmed = source.trim()
  if (trimmed.length === 0) {
    // Degenerate: an empty or missing settings file. Not a parse error — an
    // absent settings.json has no `permissions` key, same as `{}`.
    return { ok: true, settings: {}, rules: emptyRuleSet() }
  }
  const syntaxError = locateJsonError(trimmed)
  if (syntaxError) {
    return { ok: false, error: syntaxError }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    return {
      ok: false,
      error: { line: null, column: null, message: error instanceof Error ? error.message : String(error) }
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      error: { line: null, column: null, message: 'The settings file must be a JSON object.' }
    }
  }
  const settings = parsed as Record<string, unknown>
  return { ok: true, settings, rules: readRuleSet(settings.permissions) }
}

/** Adds one rule string to one category, deduping, and returns a settings
 *  object with only `.permissions.<category>` replaced. */
export function withPermissionRuleAdded(
  settings: Record<string, unknown>,
  category: PermissionRuleCategory,
  rule: string
): Record<string, unknown> {
  const trimmedRule = rule.trim()
  if (trimmedRule.length === 0) {
    return settings
  }
  const currentPermissions =
    typeof settings.permissions === 'object' &&
    settings.permissions !== null &&
    !Array.isArray(settings.permissions)
      ? (settings.permissions as Record<string, unknown>)
      : {}
  const currentRules = readRuleArray(currentPermissions[category])
  if (currentRules.includes(trimmedRule)) {
    return settings
  }
  return {
    ...settings,
    permissions: {
      ...currentPermissions,
      [category]: [...currentRules, trimmedRule]
    }
  }
}

/** Removes one rule string from one category. A no-op (returns the same
 *  reference) if the rule was never there. */
export function withPermissionRuleRemoved(
  settings: Record<string, unknown>,
  category: PermissionRuleCategory,
  rule: string
): Record<string, unknown> {
  const currentPermissions =
    typeof settings.permissions === 'object' &&
    settings.permissions !== null &&
    !Array.isArray(settings.permissions)
      ? (settings.permissions as Record<string, unknown>)
      : {}
  const currentRules = readRuleArray(currentPermissions[category])
  if (!currentRules.includes(rule)) {
    return settings
  }
  return {
    ...settings,
    permissions: {
      ...currentPermissions,
      [category]: currentRules.filter((existing) => existing !== rule)
    }
  }
}

export function serializePermissionSettings(settings: Record<string, unknown>): string {
  return JSON.stringify(settings, null, 2) + '\n'
}
