import { readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { censusSourceFiles } from '../test-support/census-source-files'

/**
 * A HUD observation's modes are footer state: the screen reads them, and
 * nothing else may state one. Three places built an observation with no
 * screen under it and each seeded its own mode. The beacon merge said null,
 * the host-status merge said 'default', which the pill draws as Manual, so on
 * a host that sends effort the pill claimed Manual while Claude was in Accept
 * edits, Plan or Auto; the held screen in use-mobile-native-chat-hud.ts said
 * 'default' too (review, 2026-09-30). All three now start from
 * NO_SCREEN_HUD_OBSERVATION.
 *
 * The held screen feeds only the model and the ring today, so no behaviour
 * shows its seed. This reads the code for the shape instead: a mode field
 * given a string literal, or a literal fallback (`?? 'default'`), is a mode
 * nobody read. A mode mapped from something read (`read ? 'plan' : 'default'`)
 * is a reading, and is left alone.
 *
 * The AST, not the text: these files explain the defect in comments that
 * quote the very literal this looks for.
 */

const mobileRoot = fileURLToPath(new URL('../..', import.meta.url))
const SOURCE = new Set(['.ts', '.tsx'])
const MODE_FIELDS = new Set(['permissionMode', 'permissionModeSeen', 'agentMode'])

function isAppSource(path: string): boolean {
  return SOURCE.has(extname(path)) && !/\.test(?:-support)?\.tsx?$/.test(path) && !path.includes('/fixtures/')
}

function isLiteralSeed(initializer: ts.Expression): boolean {
  if (ts.isStringLiteralLike(initializer)) {
    return true
  }
  if (ts.isParenthesizedExpression(initializer)) {
    return isLiteralSeed(initializer.expression)
  }
  if (ts.isBinaryExpression(initializer)) {
    const operator = initializer.operatorToken.kind
    return (
      (operator === ts.SyntaxKind.QuestionQuestionToken || operator === ts.SyntaxKind.BarBarToken) &&
      isLiteralSeed(initializer.right)
    )
  }
  return false
}

function literalModeSeeds(path: string): string[] {
  const source = readFileSync(path, 'utf8')
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    extname(path) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const seeds: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      MODE_FIELDS.has(node.name.text) &&
      isLiteralSeed(node.initializer)
    ) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
      seeds.push(`${relative(mobileRoot, path)}:${line + 1}: ${node.getText(file)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return seeds
}

describe('the HUD states no mode that no screen read', () => {
  const files = ['app', 'src'].flatMap((directory) => censusSourceFiles(join(mobileRoot, directory))).filter(isAppSource)

  it('walks the HUD merges it fences', () => {
    const walked = files.map((path) => relative(mobileRoot, path))
    expect(walked).toEqual(
      expect.arrayContaining([
        'src/session/hud-agent-status-fields.ts',
        'src/session/hud-beacon-fields.ts',
        'src/session/use-mobile-native-chat-hud.ts'
      ])
    )
  })

  it('seeds no permission or agent mode from a literal anywhere in the app', () => {
    expect(files.flatMap(literalModeSeeds)).toEqual([])
  })

  it('sees a literal seed and a literal fallback, and lets a mapped reading pass', () => {
    const probe = (text: string) => {
      const file = ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
      const found: boolean[] = []
      const visit = (node: ts.Node): void => {
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && MODE_FIELDS.has(node.name.text)) {
          found.push(isLiteralSeed(node.initializer))
        }
        ts.forEachChild(node, visit)
      }
      visit(file)
      return found
    }
    expect(probe(`const a = { permissionMode: 'default' }`)).toEqual([true])
    expect(probe(`const a = { permissionModeSeen: read ?? ('manual') }`)).toEqual([true])
    expect(probe(`const a = { agentMode: plan ? 'plan' : 'default' }`)).toEqual([false])
    expect(probe(`const a = { permissionMode: null, permissionModeSeen: read }`)).toEqual([false, false])
  })
})
