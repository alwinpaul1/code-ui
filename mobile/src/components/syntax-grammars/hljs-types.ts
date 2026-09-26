import type { LanguageFn } from 'lowlight'

// highlight.js's own types, reached through lowlight: highlight.js is not a
// direct dependency of the app, so its module cannot be imported by name.
export type { LanguageFn }
export type HLJSApi = Parameters<LanguageFn>[0]
export type Language = ReturnType<LanguageFn>
export type Mode = NonNullable<Language['contains']>[number]
/** What a mode's `contains` accepts: another mode, or the mode itself. */
export type ModeReference = Mode | 'self'
