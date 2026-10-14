import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../test/contrast'
import { darkColors, lightColors } from './tokens'

// Reported 2026-10-14 from a Samsung phone: "see no cursor in input box even
// keyboard is open ... fix it everywhere". React Native 0.86 colours the
// Android caret from the `cursorColor` prop alone (ReactTextInputManager:
// `selectionColor` tints the highlight and the handles, never the caret).
// No field in the app set it, so every caret was AppCompat's default teal
// (colorAccent: #008577 in light, #80CBC4 in dark), the one colour in the app
// that ignores the user's theme. Every field now names `colors.caret`, the
// muted tone the Claude app's composer gives its cursor.

const MOBILE = fileURLToPath(new URL('../..', import.meta.url))
const ROOTS = ['src', 'app']

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return tsxFiles(path)
    }
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : []
  })
}

type FieldReport = { readonly at: string; readonly cursorColor: string | null }

/** Every `<TextInput>` element in the source, read from the syntax tree so a
 *  comment that mentions the prop cannot satisfy it, with what its
 *  `cursorColor` attribute holds (null when it has none). */
function textInputFields(): FieldReport[] {
  const reports: FieldReport[] = []
  for (const root of ROOTS) {
    for (const path of tsxFiles(join(MOBILE, root))) {
      const source = readFileSync(path, 'utf8')
      const file = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      )
      const visit = (node: ts.Node): void => {
        if (
          (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
          node.tagName.getText(file) === 'TextInput'
        ) {
          const attribute = node.attributes.properties.find(
            (property): property is ts.JsxAttribute =>
              ts.isJsxAttribute(property) && property.name.getText(file) === 'cursorColor'
          )
          const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
          reports.push({
            at: `${relative(MOBILE, path)}:${line}`,
            cursorColor: attribute?.initializer ? attribute.initializer.getText(file) : null
          })
        }
        ts.forEachChild(node, visit)
      }
      visit(file)
    }
  }
  return reports
}

describe('the caret in every text field', () => {
  it('is drawn in the theme caret colour, not Android default teal, in every field in the app', () => {
    const fields = textInputFields()
    const wrong = fields.filter((field) => field.cursorColor !== '{colors.caret}')
    expect(wrong).toEqual([])
  })

  it('still finds the fields it checks, so a broken walk cannot pass', () => {
    const fields = textInputFields()
    // 68 fields on 2026-10-14; the floor only has to rule out an empty walk.
    expect(fields.length).toBeGreaterThan(50)
    const dockFields = fields.filter((field) =>
      field.at.startsWith('src/session/MobileSessionCommandDock.tsx:')
    )
    // The live field and the buffered command field.
    expect(dockFields).toHaveLength(2)
  })

  it("matches the Claude app's composer cursor in light and dark", () => {
    // pl7.Q per scheme (r59.n light, r59.l dark), also its placeholder.
    expect(lightColors.caret).toBe('#7B7974')
    expect(darkColors.caret).toBe('#97958D')
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('reads at 3:1 or better on every solid field surface in %s', (_scheme, palette) => {
    for (const surface of [palette.bg, palette.bgPanel, palette.bgRaised, palette.bgSunken]) {
      expect(contrastRatio(palette.caret, surface), surface).toBeGreaterThanOrEqual(3)
    }
  })
})
