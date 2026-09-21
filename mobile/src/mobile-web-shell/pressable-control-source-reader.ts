import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

/**
 * Reads what a Pressable's source says about itself, for the accessibility censuses that judge
 * controls without rendering them. Shared so the two censuses cannot drift into disagreeing about
 * what an unnamed control looks like: the ways of writing "no name" are the easy thing to miss, and
 * a census that misses one is green on exactly the regression it exists to catch.
 */
// CODE UI: this fork's controls also sit behind its own pressables — `IconButton` and `Chip`
// (src/ui), which fix the button role themselves, and the tasks screen's `TasksButton`, a
// PressFeedback that forwards every prop to a Pressable — so the censuses read those as pressables
// too. A census that needs the fixed role reads it from the component's source.
export const PRESSABLE_TAGS = new Set(['Pressable', 'TouchableOpacity', 'IconButton', 'Chip', 'TasksButton'])

/** The role a fork component fixes in its own source, read from that file; undefined when it does
 *  not (the census then reads the element's own prop). */
export function roleFixedByComponent(mobileRoot: string, tag: string): string | undefined {
  const file = tag === 'IconButton' ? 'src/ui/IconButton.tsx' : tag === 'Chip' ? 'src/ui/Chip.tsx' : null
  if (!file) {
    return undefined
  }
  return /accessibilityRole="button"/.test(readFileSync(join(mobileRoot, file), 'utf8')) ? 'button' : undefined
}

/** A spread hides the props a census reads, so it answers "unknown" rather than "absent". */
export type Read = { known: true; value: string } | { known: false }
const UNKNOWN: Read = { known: false }

/** Formatting differs between call sites, so compare what an expression says, not how it wraps. */
function normalize(source: string): string {
  return source.replace(/\s+/g, ' ').trim()
}

export function spreadsProps(element: ts.JsxOpeningLikeElement): boolean {
  return element.attributes.properties.some((property) => ts.isJsxSpreadAttribute(property))
}

/**
 * The empty reads are the point: `prop`, `prop=""`, `{''}`, `` {``} `` and `{undefined}` are all a
 * control with nothing to announce, and only the first two look empty as source text.
 */
function readExpression(expression: ts.Expression): string {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text
  }
  if (ts.isIdentifier(expression) && expression.text === 'undefined') {
    return ''
  }
  return normalize(expression.getText())
}

export function readAttribute(element: ts.JsxOpeningLikeElement, name: string): Read {
  if (spreadsProps(element)) {
    return UNKNOWN
  }
  for (const property of element.attributes.properties) {
    if (ts.isJsxAttribute(property) && property.name.getText() === name) {
      const initializer = property.initializer
      if (!initializer) {
        return { known: true, value: '' }
      }
      if (ts.isStringLiteral(initializer)) {
        return { known: true, value: initializer.text }
      }
      if (ts.isJsxExpression(initializer) && initializer.expression) {
        return { known: true, value: readExpression(initializer.expression) }
      }
      return { known: true, value: normalize(initializer.getText()) }
    }
  }
  return { known: true, value: '' }
}
