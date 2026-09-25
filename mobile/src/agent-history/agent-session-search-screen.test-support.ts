import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'

/**
 * Reading and driving the history screen in the session-search suites, which mock `react-native`
 * with string host types: `Text` holds the words, `Pressable` the handler.
 */

/** Everything a Text node says, nested runs included, the way the device would draw it. */
export function textContent(node: ReactTestInstance | string | number): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  return node.children.map(textContent).join('')
}

function isText(node: ReactTestInstance): boolean {
  return String(node.type) === 'Text'
}

/** Every line of text on screen: one entry per outermost Text node. */
export function screenTexts(rendered: ReactTestRenderer): string[] {
  return rendered.root
    .findAll((node) => isText(node) && !(node.parent && isText(node.parent)))
    .map(textContent)
}

export function textNode(rendered: ReactTestRenderer, text: string): ReactTestInstance {
  const node = rendered.root.findAll(
    (candidate) => isText(candidate) && textContent(candidate) === text
  )[0]
  if (!node) {
    throw new Error(`no text "${text}" on screen:\n${screenTexts(rendered).join('\n')}`)
  }
  return node
}

export function hasText(rendered: ReactTestRenderer, text: string): boolean {
  return screenTexts(rendered).includes(text)
}

/** The Pressable a label sits in. */
export function pressableFor(rendered: ReactTestRenderer, text: string): ReactTestInstance {
  let node: ReactTestInstance | null = textNode(rendered, text)
  while (node && String(node.type) !== 'Pressable') {
    node = node.parent
  }
  if (!node) {
    throw new Error(`"${text}" is not inside a Pressable`)
  }
  return node
}

export function hostAncestors(node: ReactTestInstance): string[] {
  const types: string[] = []
  let current = node.parent
  while (current) {
    if (typeof current.type === 'string') {
      types.push(current.type)
    }
    current = current.parent
  }
  return types
}

const PRESS_EVENT = { stopPropagation: () => {} }

export async function press(node: ReactTestInstance): Promise<void> {
  await act(async () => {
    node.props.onPress(PRESS_EVENT)
  })
}

export async function pressText(rendered: ReactTestRenderer, text: string): Promise<void> {
  await press(pressableFor(rendered, text))
}
