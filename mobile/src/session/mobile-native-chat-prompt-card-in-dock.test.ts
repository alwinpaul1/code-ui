import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const viewPath = fileURLToPath(new URL('./MobileNativeChatView.tsx', import.meta.url))

function parse(): ts.SourceFile {
  return ts.createSourceFile(
    viewPath,
    readFileSync(viewPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
}

function elementName(node: ts.Node): string | null {
  if (ts.isJsxElement(node)) {
    return node.openingElement.tagName.getText()
  }
  return ts.isJsxSelfClosingElement(node) ? node.tagName.getText() : null
}

/** The JSX element carrying `testID="native-chat-dock"`. */
function findDock(source: ts.SourceFile): ts.JsxElement | null {
  let found: ts.JsxElement | null = null
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const hasDockTestId = node.openingElement.attributes.properties.some(
        (property) =>
          ts.isJsxAttribute(property) &&
          property.name.getText() === 'testID' &&
          property.initializer?.getText().includes('native-chat-dock"')
      )
      if (hasDockTestId) {
        found = node
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function descendantNames(node: ts.Node): string[] {
  const names: string[] = []
  const visit = (child: ts.Node): void => {
    const name = elementName(child)
    if (name) {
      names.push(name)
    }
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return names
}

describe('the agent prompt card', () => {
  it('renders inside the dock, where the chat list makes room for it', () => {
    // The dock is `position: absolute; bottom: 0`, so anything left in normal
    // flow beside it is painted UNDER it. A long "Allow Bash?" had its choices
    // covered by the tools row and the composer, and they could not be tapped
    // (reported from the phone with a screen recording, 2026-09-13). Only the
    // dock's height feeds the list spacer, so the card has to be measured with
    // it — which also keeps the newest messages clear of it.
    const source = parse()
    const dock = findDock(source)
    expect(dock).not.toBeNull()
    expect(descendantNames(dock!)).toContain('MobileNativeChatPromptCard')
  })

  it('has no second prompt card left outside the dock', () => {
    const source = parse()
    const dock = findDock(source)
    const everywhere = descendantNames(source).filter(
      (name) => name === 'MobileNativeChatPromptCard'
    )
    const inDock = descendantNames(dock!).filter((name) => name === 'MobileNativeChatPromptCard')
    expect(everywhere).toEqual(inDock)
  })
})
