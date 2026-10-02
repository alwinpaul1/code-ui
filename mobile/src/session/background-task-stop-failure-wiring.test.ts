import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * A defect of structure, pinned the only way it can be. The Background tasks
 * sheet says a failed Stop in the sheet only when it is handed the chat's own
 * reporter and the tab's scope (MobileBackgroundTasksSheet.stop-failure.test.tsx),
 * and those come from the session screen, four components up. Every render
 * test of the sheet passes with the chain broken anywhere along it, and the
 * sheet then quietly hands the Stop no reporter, so its failure goes back to
 * the banner under the sheet. This reads the code (the AST, never a comment)
 * for each join.
 */
const SESSION_DIR = import.meta.dirname

function parse(name: string): ts.SourceFile {
  const path = join(SESSION_DIR, name)
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

/** Each JSX element named `tag`, as a map of its attribute names to the source
 *  text of their values. */
function jsxAttributes(source: ts.SourceFile, tag: string): Array<Map<string, string>> {
  const found: Array<Map<string, string>> = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (ts.isIdentifier(node.tagName) && node.tagName.text === tag) {
        const attributes = new Map<string, string>()
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name)) {
            const value = attribute.initializer
            const expression =
              value && ts.isJsxExpression(value) && value.expression ? value.expression : value
            attributes.set(attribute.name.text, expression ? expression.getText(source) : '')
          }
        }
        found.push(attributes)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function onlyMount(file: string, tag: string): Map<string, string> {
  const mounts = jsxAttributes(parse(file), tag)
  expect(mounts).toHaveLength(1)
  return mounts[0]!
}

describe("a failed background-task Stop reaches the sheet's own reporter", () => {
  it("is handed the chat's own reporter by the session screen", () => {
    const overlay = onlyMount('MobileSessionActiveContent.tsx', 'MobileNativeChatOverlay')
    expect(overlay.get('onSendFailure')).toBe('nativeChatSendError.show')
  })

  it('passes it and the tab to the chat view', () => {
    const view = onlyMount('MobileNativeChatOverlay.tsx', 'MobileNativeChatShellConfirmView')
    expect(view.get('reportBackgroundTaskFailure')).toBe('onSendFailure')
    expect(view.get('sendSurfaceId')).toBe('sendSurfaceId')
  })

  it('passes both from the chat view to the tasks provider', () => {
    const provider = onlyMount('MobileNativeChatView.tsx', 'MobileNativeChatTasksProvider')
    expect(provider.get('reportStopFailure')).toBe('reportBackgroundTaskFailure')
    expect(provider.get('scopeKey')).toBe('sendSurfaceId')
  })

  it('passes both from the tasks provider to the sheet', () => {
    const sheet = onlyMount('MobileNativeChatTasksProvider.tsx', 'MobileBackgroundTasksSheet')
    expect(sheet.get('reportStopFailure')).toBe('reportStopFailure')
    expect(sheet.get('scopeKey')).toBe('scopeKey')
  })
})
