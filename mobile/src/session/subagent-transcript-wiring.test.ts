import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * A defect of structure, pinned the only way it can be: the subagent viewer is
 * a modal fed by a store, and the roster row that opens it sits three
 * components below the screen that knows the host. Every unit test of the
 * viewer, the store and the row passes with the modal mounted nowhere and the
 * row never told which agent owns the tab — and the feature is then dead on
 * the phone. This reads the code (the AST, never a comment) for the two
 * joins.
 */
const SESSION_DIR = import.meta.dirname

function parse(name: string): ts.SourceFile {
  const path = join(SESSION_DIR, name)
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

/** JSX elements named `tag`, with their attribute names. */
function jsxElements(source: ts.SourceFile, tag: string): string[][] {
  const found: string[][] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (ts.isIdentifier(node.tagName) && node.tagName.text === tag) {
        found.push(
          node.attributes.properties.flatMap((attribute) =>
            ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) ? [attribute.name.text] : []
          )
        )
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('the subagent transcript viewer is reachable from the session screen', () => {
  it('is mounted once by the session content, with the host it reads from', () => {
    const mounts = jsxElements(parse('MobileSessionActiveContent.tsx'), 'MobileSubagentTranscriptModal')
    expect(mounts).toHaveLength(1)
    expect(mounts[0]).toEqual(expect.arrayContaining(['hostId', 'worktreeId']))
  })

  it('is told which agent owns the tab, or every row stays a plain row', () => {
    const sheets = jsxElements(parse('MobileNativeChatView.tsx'), 'MobileBackgroundTasksSheet')
    expect(sheets).toHaveLength(1)
    expect(sheets[0]).toContain('agent')
  })
})
