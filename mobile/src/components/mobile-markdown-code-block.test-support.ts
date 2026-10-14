import type { ReactTestInstance } from 'react-test-renderer'

// How a test finds a fenced code block in a rendered Markdown tree and reads
// the code it drew. A fence is a card (testID `markdown-code-block`): the
// header row, then a body whose runs of up to 24 lines are one Text each
// (MobileMarkdownCodeText.tsx). The tests that used to find a block by its
// fill, and its lines by the numbered rows of the old gutter, go through here.

const isHost = (node: ReactTestInstance, testID: string): boolean =>
  typeof node.type === 'string' && node.props.testID === testID

/** The code blocks under `root`, in document order. */
export function codeBlockCards(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll((node) => isHost(node, 'markdown-code-block'))
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('')
}

/** A card's code as drawn: its runs, one after another. A run that ends on a
 *  blank line carries one filler space so the engine draws that line; it is
 *  not code, and is taken back off here. */
export function codeBlockCode(card: ReactTestInstance): string {
  const [body] = card.findAll((node) => isHost(node, 'markdown-code-body'))
  const runs = body!.findAll((node) => (node.type as unknown) === 'Text' && node.props.selectable !== undefined)
  return runs
    .map((run) => {
      const text = textOf(run)
      return text === ' ' || text.endsWith('\n ') ? text.slice(0, -1) : text
    })
    .join('\n')
}
