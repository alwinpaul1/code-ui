import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { readMobileSessionRouteSource } from './mobile-session-route-source-family.test-support'

/**
 * Reported 2026-09-18 with a screenshot: "Opus 5 (1M context) xhigh" in the
 * header pill ran under the terminal icon. The pill sits in a row inside the
 * title column (`flex: 1, minWidth: 0`), but a flex child shrinks only when it
 * says so, and the pill's View did not — so a long live label pushed the row
 * past its column into the action icons instead of truncating.
 *
 * A layout defect has no behavioural handle in a test renderer (Yoga is not
 * run there), so this reads the source: the pill's own container must opt into
 * shrinking, and the label inside it must be one truncated line.
 */
const sourcePath = './MobileSessionHeader.tsx'
const source = readMobileSessionRouteSource(sourcePath)
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function findModelPill(): ts.JsxElement {
  let found: ts.JsxElement | null = null
  function visit(node: ts.Node): void {
    if (found) {
      return
    }
    if (ts.isJsxElement(node)) {
      const label = node.openingElement.attributes.properties.find(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(sourceFile) === 'accessibilityLabel' &&
          attribute.initializer?.getText(sourceFile).includes('Model ${modelLabel}')
      )
      if (label) {
        found = node
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  expect(found, 'the model pill (accessibilityLabel `Model ${modelLabel}`)').not.toBeNull()
  return found!
}

function styleProperties(element: ts.JsxElement): Map<string, string> {
  const style = element.openingElement.attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === 'style'
  ) as ts.JsxAttribute | undefined
  expect(style, 'the pill has a style attribute').toBeDefined()
  const expression = style!.initializer
  expect(expression && ts.isJsxExpression(expression) && expression.expression).toBeTruthy()
  const object = (expression as ts.JsxExpression).expression!
  expect(ts.isObjectLiteralExpression(object), 'the pill style is one object literal').toBe(true)
  const out = new Map<string, string>()
  for (const property of (object as ts.ObjectLiteralExpression).properties) {
    if (ts.isPropertyAssignment(property)) {
      out.set(property.name.getText(sourceFile), property.initializer.getText(sourceFile))
    }
  }
  return out
}

describe('the header model pill fits beside the action icons', () => {
  it('shrinks with its column instead of running under the terminal icon', () => {
    const style = styleProperties(findModelPill())
    expect(style.get('flexShrink')).toBe('1')
    expect(style.get('minWidth')).toBe('0')
  })

  it('truncates the live label to one line rather than wrapping or overflowing', () => {
    const pill = findModelPill()
    const text = pill.children.find(
      (child): child is ts.JsxElement =>
        ts.isJsxElement(child) && child.openingElement.tagName.getText(sourceFile) === 'Txt'
    )
    expect(text, 'the pill holds one Txt').toBeDefined()
    const lines = text!.openingElement.attributes.properties.find(
      (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === 'numberOfLines'
    ) as ts.JsxAttribute | undefined
    expect(lines?.initializer?.getText(sourceFile)).toBe('{1}')
  })
})
