/**
 * Reported 2026-10-14: after pasting the Anthropic sign-in code, Done had to be tapped twice. The
 * field and Done sit inside a ScrollView with React Native's default `keyboardShouldPersistTaps`
 * ('never'), so with the keyboard up the first tap only dismissed it and never reached Done.
 *
 * The defect is structural (a missing prop on a native scroll container), so this census reads the
 * source: every scrolling container in a screen that holds a TextInput sets
 * `keyboardShouldPersistTaps`, so a tap on a button beside a focused field lands the first time.
 * It walks the JSX tree, not the text, so the long "why" comments in these files cannot satisfy it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')
const SCROLLERS = new Set([
  'ScrollView',
  'FlatList',
  'SectionList',
  'Animated.ScrollView',
  'Animated.FlatList',
  'KeyboardAwareScrollView',
  'BottomSheetScrollView'
])

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path))
    } else if (name.endsWith('.tsx') && !name.includes('.test.')) {
      out.push(path)
    }
  }
  return out
}

function tagName(tag: ts.JsxTagNameExpression): string {
  return tag.getText()
}

/** `file:line Tag` for each scroller lacking the prop, in files that render a TextInput. */
function missingPersistTaps(files: readonly string[]): string[] {
  const missing: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const openings: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = []
    let rendersTextInput = false
    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = tagName(node.tagName)
        if (name === 'TextInput') {
          rendersTextInput = true
        }
        if (SCROLLERS.has(name)) {
          openings.push(node)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    if (!rendersTextInput) {
      continue
    }
    for (const opening of openings) {
      const hasProp = opening.attributes.properties.some(
        (prop) => ts.isJsxAttribute(prop) && prop.name.getText() === 'keyboardShouldPersistTaps'
      )
      if (!hasProp) {
        const line = source.getLineAndCharacterOfPosition(opening.getStart()).line + 1
        missing.push(`${relative(ROOT, file)}:${line} ${tagName(opening.tagName)}`)
      }
    }
  }
  return missing
}

describe('a tap beside a focused field', () => {
  const files = [...sourceFiles(join(ROOT, 'app')), ...sourceFiles(join(ROOT, 'src'))]

  it('walks the app routes and the components, including Voice settings', () => {
    expect(files.some((file) => file.endsWith(join('app', 'voice-settings.tsx')))).toBe(true)
    expect(files.length).toBeGreaterThan(100)
  })

  it('lands the first time: every scroller in a screen with a TextInput keeps taps with the keyboard up', () => {
    expect(missingPersistTaps(files)).toEqual([])
  })
})
