/**
 * Which colour role a piece of highlighted code plays, from the classes
 * highlight.js (through lowlight) puts on it.
 *
 * The roles follow what VS Code's Dark+ and Light+ themes colour apart, since
 * the desktop is Monaco with that theme and the phone should read the same
 * (reported 2026-09-26: the phone drew `import` and `def` alike, `None` as a
 * number, and a class name as a function). highlight.js tags scopes with a
 * trailing underscore (`title function_`, `title class_ inherited__`,
 * `variable language_`); an earlier mapping looked for `title.function` and
 * never matched, so every class name fell through to "function".
 */

export type MobileSyntaxTokenKind =
  | 'plain'
  | 'comment'
  /** Declarations and operators: def, class, const, not. Blue in Dark+. */
  | 'keyword'
  /** Flow: if, for, return, import. Purple in Dark+. */
  | 'control'
  | 'string'
  | 'number'
  /** True, None, null, undefined. */
  | 'literal'
  /** len, print, dict. */
  | 'builtIn'
  | 'type'
  | 'function'
  /** JSON and YAML keys, HTML attributes. */
  | 'attribute'
  | 'property'
  /** Parameters, variables, interpolations. */
  | 'variable'
  | 'punctuation'
  | 'tag'
  | 'meta'
  /** Brackets by nesting depth (mobile-syntax-brackets.ts). */
  | 'bracket1'
  | 'bracket2'
  | 'bracket3'

/** A class-derived scope. Two need the text to pick a role, so they stay
 *  open until a text node arrives. */
export type MobileSyntaxScope = MobileSyntaxTokenKind | 'params' | 'languageVariable'

const CONTROL_KEYWORDS = new Set([
  'if', 'elif', 'else', 'for', 'while', 'do', 'in', 'of', 'return', 'import', 'from',
  'export', 'try', 'except', 'catch', 'finally', 'raise', 'throw', 'throws', 'break',
  'continue', 'switch', 'case', 'default', 'yield', 'await', 'with', 'as', 'pass',
  'goto', 'match', 'then', 'fi', 'done', 'esac', 'elsif', 'unless', 'until', 'loop',
  'defer', 'go', 'select', 'fallthrough'
])

/** Built-ins that are types. Dark+ draws TypeScript's `string` as a type,
 *  while Python's `len` or `dict` read as functions. */
const PRIMITIVE_TYPES = new Set([
  'string', 'number', 'boolean', 'void', 'any', 'unknown', 'never', 'object',
  'symbol', 'bigint', 'undefined'
])

/** A `variable language_` that names the instance reads as a keyword; the
 *  rest (console, window, document) are globals, which Dark+ draws as types. */
const SELF_WORDS = new Set(['self', 'this', 'super', 'cls'])

export function scopeForClasses(
  className: unknown,
  inherited: MobileSyntaxScope
): MobileSyntaxScope | null {
  const classes = Array.isArray(className)
    ? className.filter((value): value is string => typeof value === 'string')
    : typeof className === 'string'
      ? className.split(/\s+/)
      : []
  const scopes = new Set(classes.map((value) => value.replace(/^hljs-/, '')))
  const own = ownScope(scopes)
  // JSON's true/false/null are keywords inside a literal: keep them literal.
  if (own === 'keyword' && inherited === 'literal') {
    return 'literal'
  }
  return own
}

function ownScope(scopes: Set<string>): MobileSyntaxScope | null {
  if (hasAny(scopes, ['comment', 'quote'])) {
    return 'comment'
  }
  if (scopes.has('title')) {
    return hasAny(scopes, ['class_', 'inherited__']) ? 'type' : 'function'
  }
  if (scopes.has('variable') && scopes.has('language_')) {
    return 'languageVariable'
  }
  if (hasAny(scopes, ['keyword', 'doctag', 'section'])) {
    return 'keyword'
  }
  if (hasAny(scopes, ['name', 'selector-tag', 'selector-class', 'selector-id', 'selector-pseudo'])) {
    return 'tag'
  }
  if (hasAny(scopes, ['string', 'regexp', 'symbol', 'char', 'code', 'link'])) {
    return 'string'
  }
  if (scopes.has('number')) {
    return 'number'
  }
  if (scopes.has('literal')) {
    return 'literal'
  }
  if (scopes.has('built_in')) {
    return 'builtIn'
  }
  if (hasAny(scopes, ['type', 'class'])) {
    return 'type'
  }
  if (scopes.has('attr')) {
    return 'attribute'
  }
  if (hasAny(scopes, ['attribute', 'property'])) {
    return 'property'
  }
  if (scopes.has('params')) {
    return 'params'
  }
  if (hasAny(scopes, ['variable', 'template-variable', 'subst'])) {
    return 'variable'
  }
  if (hasAny(scopes, ['punctuation', 'operator', 'bullet', 'tag'])) {
    return 'punctuation'
  }
  if (hasAny(scopes, ['meta'])) {
    return 'meta'
  }
  return null
}

/** The role of one run of text under a scope. */
export function kindsForText(
  text: string,
  scope: MobileSyntaxScope
): { text: string; kind: MobileSyntaxTokenKind }[] {
  switch (scope) {
    case 'params':
      // Only the names: the commas, `=` and `**` between them stay plain.
      return text
        .split(/([A-Za-z_$][\w$]*)/)
        .filter((piece) => piece.length > 0)
        .map((piece) => ({ text: piece, kind: /^[A-Za-z_$]/.test(piece) ? 'variable' : 'plain' }))
    case 'languageVariable':
      return [{ text, kind: SELF_WORDS.has(text.trim()) ? 'keyword' : 'type' }]
    case 'keyword':
      return [{ text, kind: CONTROL_KEYWORDS.has(text.trim()) ? 'control' : 'keyword' }]
    case 'builtIn':
      return [{ text, kind: PRIMITIVE_TYPES.has(text.trim()) ? 'type' : 'builtIn' }]
    default:
      return [{ text, kind: scope }]
  }
}

function hasAny(values: Set<string>, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => values.has(candidate))
}
