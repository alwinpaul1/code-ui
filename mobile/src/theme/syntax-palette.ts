import type { MobileSyntaxTokenKind } from '../session/mobile-syntax-token-kinds'
import type { ThemeScheme } from './tokens'

/** The colours code is drawn in: one per token role, plus the editor surface,
 *  the line numbers and the indent guides. Read through `useTheme().syntax`;
 *  a literal colour in a code view ignores the reader's appearance setting. */
export type SyntaxPalette = Record<MobileSyntaxTokenKind, string> & {
  surface: string
  gutter: string
  indentGuide: string
}

/** Every role a code span can take, for tests that walk the palette. */
export const SYNTAX_TOKEN_ROLES: readonly MobileSyntaxTokenKind[] = [
  'plain', 'comment', 'keyword', 'control', 'string', 'number', 'literal', 'function',
  'builtIn', 'type', 'attribute', 'property', 'variable', 'punctuation', 'tag', 'meta',
  'bracket1', 'bracket2', 'bracket3'
]

/** VS Code's Dark+, which the desktop's Monaco editor draws (screenshot,
 *  2026-09-26), on the reader's warm dark surface. Bracket colours are Dark+'s
 *  bracket-pair colours, by depth. */
export const darkSyntaxPalette: SyntaxPalette = {
  surface: '#1E1C19',
  gutter: '#858585',
  indentGuide: '#404040',
  plain: '#D4D4D4',
  comment: '#6A9955',
  keyword: '#569CD6',
  control: '#C586C0',
  string: '#CE9178',
  number: '#B5CEA8',
  literal: '#569CD6',
  function: '#DCDCAA',
  builtIn: '#DCDCAA',
  type: '#4EC9B0',
  attribute: '#9CDCFE',
  property: '#9CDCFE',
  variable: '#9CDCFE',
  punctuation: '#D4D4D4',
  tag: '#569CD6',
  meta: '#C586C0',
  bracket1: '#FFD700',
  bracket2: '#DA70D6',
  bracket3: '#179FFF'
}

/** VS Code's Light+ on the app's light panel. Five of its colours are a shade
 *  darker than Light+ ships (comment #008000, number #098658, type #267F99,
 *  control #AF00DB, bracket #319331): on this cream surface, and on the chat's
 *  code-block fill, the originals fell under 4.5:1 (syntax-palette.test.ts). */
export const lightSyntaxPalette: SyntaxPalette = {
  surface: '#FBFAF6',
  gutter: '#237893',
  indentGuide: '#D3D3D3',
  plain: '#1E1C19',
  comment: '#007000',
  keyword: '#0000FF',
  control: '#A000C8',
  string: '#A31515',
  number: '#067350',
  literal: '#0000FF',
  function: '#795E26',
  builtIn: '#795E26',
  type: '#1F6E85',
  attribute: '#0451A5',
  property: '#001080',
  variable: '#001080',
  punctuation: '#1E1C19',
  tag: '#800000',
  meta: '#A000C8',
  bracket1: '#0431FA',
  bracket2: '#257325',
  bracket3: '#7B3814'
}

export function syntaxPaletteForScheme(scheme: ThemeScheme): SyntaxPalette {
  return scheme === 'dark' ? darkSyntaxPalette : lightSyntaxPalette
}
