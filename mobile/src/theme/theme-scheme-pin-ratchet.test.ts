import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * No app code pins a palette to one scheme. On 2026-09-27 screens drew dark in a light session
 * through three doors a sweep for `import { colors } from 'mobile-theme'` never saw: a style
 * module that exported sheets built against a Theme pinned to `colorsForScheme('dark')`, a helper
 * whose palette parameter defaulted to `darkColors`, and a barrel that re-exported the static
 * palette. The static palette is deleted, so that import no longer compiles; this pins the rest of
 * the shape: outside src/theme/, nothing names `darkColors` / `darkSyntaxPalette` (or the light
 * mirror, which ignores the setting the same way), asks `colorsForScheme` / `syntaxPaletteForScheme`
 * for a literal scheme, or pins a ThemeProvider.
 *
 * Source-reading because the defect is WHICH palette a module reads: a render test sees only the
 * scheme it was run in. It walks the syntax tree, so the many comments in this codebase that name
 * `darkColors` (like this one) are never matched.
 */

const MOBILE = join(import.meta.dirname, '..', '..')

/** Terminal CONTENT, which is Tokyonight in both schemes on purpose (the WebView frame, its HTML
 *  theme, and the engine error state drawn over the terminal). App chrome around it is themed. */
const TERMINAL_CONTENT = [
  'src/terminal/document/terminal-theme.ts',
  'src/terminal/terminal-webview-frame-styles.ts',
  'src/terminal/terminal-webview-html/document-style.ts',
  'src/terminal/terminal-webview-html/theme.ts',
  'src/terminal/terminal-webview-engine-error-state.tsx'
]

const PINNED_PALETTES = new Set([
  'darkColors',
  'lightColors',
  'darkSyntaxPalette',
  'lightSyntaxPalette'
])
const SCHEME_LOOKUPS = new Set(['colorsForScheme', 'syntaxPaletteForScheme'])

function sourceFiles(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      sourceFiles(path, into)
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !entry.name.includes('.test-support.') &&
      // Build outputs of sources this walk already reads; the terminal document bundle carries
      // `darkColors` inside a string, from terminal-theme.ts above.
      !entry.name.endsWith('.generated.ts')
    ) {
      into.push(path)
    }
  }
  return into
}

/** Every place `source` pins a scheme, as `line: what`. Syntax only: comments and strings never match. */
function schemePins(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const pins: string[] = []
  const at = (node: ts.Node, what: string) =>
    pins.push(`${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${what}`)
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && PINNED_PALETTES.has(node.text)) {
      at(node, node.text)
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      SCHEME_LOOKUPS.has(node.expression.text) &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      at(node, `${node.expression.text}('${node.arguments[0].text}')`)
    } else if (
      ts.isJsxAttribute(node) &&
      node.name.getText(file) === 'initialPreference' &&
      node.initializer !== undefined
    ) {
      at(node, `initialPreference=${node.initializer.getText(file)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return pins
}

// src/test/ and src/test-support/ are test harness (mocks, the RPC recorder and its fixtures), which
// may pin a scheme on purpose to reproduce a value; nothing in them ships.
const APP_CODE = [...sourceFiles(join(MOBILE, 'src')), ...sourceFiles(join(MOBILE, 'app'))]
  .map((path) => relative(MOBILE, path))
  .filter(
    (path) =>
      !path.startsWith('src/theme/') &&
      !path.startsWith('src/test/') &&
      !path.startsWith('src/test-support/')
  )

describe('no app code pins a palette to one scheme', () => {
  it('names no scheme-pinned palette outside src/theme/ and the terminal content files', () => {
    const offenders = APP_CODE.filter((path) => !TERMINAL_CONTENT.includes(path)).flatMap((path) =>
      schemePins(path, readFileSync(join(MOBILE, path), 'utf8')).map((pin) => `${path}:${pin}`)
    )
    expect(offenders).toEqual([])
  })

  it('still sees the pins it allows, so an emptied scan cannot pass', () => {
    expect(APP_CODE.length).toBeGreaterThan(500)
    for (const path of TERMINAL_CONTENT) {
      expect(APP_CODE, path).toContain(path)
      expect(schemePins(path, readFileSync(join(MOBILE, path), 'utf8')), path).not.toEqual([])
    }
  })

  it('matches code, not a comment or a string that names the same thing', () => {
    expect(
      schemePins(
        'x.tsx',
        [
          '// darkColors, colorsForScheme("dark") and initialPreference="dark" in prose',
          "const note = 'darkColors'",
          'export const f = (colors = darkColors) => colors',
          "const t = colorsForScheme('dark')",
          'const u = colorsForScheme(scheme)',
          'const el = <ThemeProvider initialPreference="dark" />'
        ].join('\n')
      )
    ).toEqual(['3: darkColors', "4: colorsForScheme('dark')", '6: initialPreference="dark"'])
  })
})
