// "Revert this hunk" on the landed-edit card. The card owns three things: when
// to offer the action, what to show while and after it runs, and that a hunk
// already put back is never offered twice — including across a remount, since
// the chat list drops off-screen cells and the tool line drops the card when it
// collapses.

import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEditFile, type NativeChatEditFile } from '../../../src/shared/native-chat-edit-model'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import type { HunkRevertOutcome } from './mobile-diff-hunk-revert-request'
import { resetHunkRevertMarksForTests } from './mobile-diff-hunk-revert-marks'
import { MobileNativeChatDiffCard } from './MobileNativeChatDiffCard'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  FileMinus2: 'FileMinus2',
  FilePen: 'FilePen',
  FilePlus2: 'FilePlus2'
}))

const ctx = (text: string, oldNo: number, newNo: number) =>
  ({ kind: 'context', text, oldLineNumber: oldNo, newLineNumber: newNo }) as const
const add = (text: string, newNo: number) =>
  ({ kind: 'add', text, oldLineNumber: null, newLineNumber: newNo }) as const
const del = (text: string, oldNo: number) =>
  ({ kind: 'del', text, oldLineNumber: oldNo, newLineNumber: null }) as const

/** Two hunks in one file: a replacement at line 2 and an addition at line 6. */
function twoHunks(
  overrides: Partial<Pick<NativeChatEditFile, 'changeKind' | 'path'>> = {}
): NativeChatEditFile {
  return finalizeEditFile({
    path: overrides.path ?? '/w/src/app.ts',
    oldPath: null,
    changeKind: overrides.changeKind ?? 'edited',
    lineNumbersKnown: true,
    lines: [
      ctx('a', 1, 1),
      del('b', 2),
      add('B', 2),
      ctx('c', 3, 3),
      ctx('d', 4, 4),
      ctx('e', 5, 5),
      add('f', 6)
    ]
  })
}

type Deferred = { resolve: (outcome: HunkRevertOutcome) => void }

function handlerThat(outcome: HunkRevertOutcome | 'hold') {
  const calls: number[] = []
  const held: Deferred[] = []
  const onRevertHunk = vi.fn(async (_file: NativeChatEditFile, hunkIndex: number) => {
    calls.push(hunkIndex)
    if (outcome === 'hold') {
      return new Promise<HunkRevertOutcome>((resolve) => held.push({ resolve }))
    }
    return outcome
  })
  return { onRevertHunk, calls, held }
}

describe('Revert this hunk on a landed-edit card', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => resetHunkRevertMarksForTests())
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function element(
    props: Partial<Parameters<typeof MobileNativeChatDiffCard>[0]> & { file: NativeChatEditFile },
    scheme: 'light' | 'dark' = 'light'
  ) {
    return createElement(
      ThemeProvider,
      { initialPreference: scheme },
      createElement(MobileNativeChatDiffCard, props)
    )
  }

  function render(
    props: Partial<Parameters<typeof MobileNativeChatDiffCard>[0]> & { file: NativeChatEditFile },
    scheme: 'light' | 'dark' = 'light'
  ): ReactTestRenderer {
    act(() => {
      renderer = create(element(props, scheme))
    })
    return renderer!
  }

  const buttons = (root: ReactTestInstance) =>
    root.findAll((node) => node.props?.accessibilityLabel === 'Revert this hunk')
  const texts = (root: ReactTestInstance) =>
    root
      .findAllByType('Text' as never)
      .map((node) => (typeof node.props.children === 'string' ? node.props.children : ''))
      .filter(Boolean)

  it('offers the action once under each hunk of a landed edit', () => {
    const { onRevertHunk } = handlerThat({ status: 'reverted', removed: 1, restored: 1 })
    const tree = render({ file: twoHunks(), onRevertHunk })
    expect(buttons(tree.root)).toHaveLength(2)
  })

  it('offers nothing when no handler is wired — the permission card shows a proposal, not a landed edit', () => {
    const tree = render({ file: twoHunks() })
    expect(buttons(tree.root)).toHaveLength(0)
    expect(texts(tree.root)).not.toContain('Revert this hunk')
  })

  it('marks the hunk reverted and does not offer it a second time', async () => {
    const { onRevertHunk, calls } = handlerThat({ status: 'reverted', removed: 1, restored: 1 })
    const tree = render({ file: twoHunks(), onRevertHunk })
    await act(async () => {
      buttons(tree.root)[0]!.props.onPress()
    })
    expect(calls).toEqual([0])
    expect(texts(tree.root)).toContain('Reverted')
    // The other hunk is untouched and still on offer.
    expect(buttons(tree.root)).toHaveLength(1)
  })

  it('shows the refusal and leaves the hunk on offer when the phone declines to write', async () => {
    const { onRevertHunk } = handlerThat({
      status: 'refused',
      message: 'This part of the file changed since; open the diff to revert by hand.'
    })
    const tree = render({ file: twoHunks(), onRevertHunk })
    await act(async () => {
      buttons(tree.root)[0]!.props.onPress()
    })
    expect(texts(tree.root)).toContain(
      'This part of the file changed since; open the diff to revert by hand.'
    )
    expect(texts(tree.root)).not.toContain('Reverted')
    expect(buttons(tree.root)).toHaveLength(2)
  })

  it('shows the host’s message and leaves the card unchanged when the write is rejected', async () => {
    const { onRevertHunk } = handlerThat({
      status: 'failed',
      message: "Couldn't write src/app.ts: Path escapes the workspace"
    })
    const tree = render({ file: twoHunks(), onRevertHunk })
    const before = texts(tree.root)
    await act(async () => {
      buttons(tree.root)[0]!.props.onPress()
    })
    const after = texts(tree.root)
    expect(after).toContain("Couldn't write src/app.ts: Path escapes the workspace")
    expect(after.filter((text) => text !== "Couldn't write src/app.ts: Path escapes the workspace")).toEqual(
      before
    )
    expect(buttons(tree.root)).toHaveLength(2)
  })

  it('sends one write for a double tap: the action is held while a revert is in flight', async () => {
    const { onRevertHunk, calls, held } = handlerThat('hold')
    const tree = render({ file: twoHunks(), onRevertHunk })
    await act(async () => {
      // Both taps in one tick, before any re-render could disable the button.
      const button = buttons(tree.root)[0]!
      button.props.onPress()
      button.props.onPress()
    })
    expect(calls).toEqual([0])
    expect(texts(tree.root)).toContain('Reverting…')
    const heldButton = buttons(tree.root)[0]!
    expect(heldButton.props.disabled).toBe(true)
    await act(async () => {
      heldButton.props.onPress()
    })
    expect(calls).toEqual([0])
    await act(async () => {
      held[0]!.resolve({ status: 'reverted', removed: 1, restored: 1 })
    })
    expect(texts(tree.root)).toContain('Reverted')
  })

  it('keeps the reverted mark across a re-render of the same card', async () => {
    const { onRevertHunk } = handlerThat({ status: 'reverted', removed: 1, restored: 1 })
    const tree = render({ file: twoHunks(), onRevertHunk })
    await act(async () => {
      buttons(tree.root)[0]!.props.onPress()
    })
    act(() => {
      tree.update(element({ file: twoHunks(), onRevertHunk, rowLimit: 50 }))
    })
    expect(texts(tree.root)).toContain('Reverted')
    expect(buttons(tree.root)).toHaveLength(1)
  })

  it('remembers a reverted hunk when the same card mounts again after its tool line collapsed', async () => {
    const { onRevertHunk } = handlerThat({ status: 'reverted', removed: 1, restored: 1 })
    const first = render({ file: twoHunks(), onRevertHunk })
    await act(async () => {
      buttons(first.root)[0]!.props.onPress()
    })
    act(() => renderer?.unmount())
    renderer = null
    const again = render({ file: twoHunks(), onRevertHunk })
    expect(texts(again.root)).toContain('Reverted')
    expect(buttons(again.root)).toHaveLength(1)
  })

  it('does not carry a mark onto a later card that re-applied the same edit', async () => {
    // The agent re-does an edit the user reverted: same path, same rows, same
    // numbers. It is a new card (another message), and it has not been reverted.
    const { onRevertHunk } = handlerThat({ status: 'reverted', removed: 1, restored: 1 })
    const first = render({ file: twoHunks(), onRevertHunk, revertScope: 'msg-1:0:0' })
    await act(async () => {
      buttons(first.root)[0]!.props.onPress()
    })
    expect(onRevertHunk.mock.calls[0]?.[2]).toBe('msg-1:0:0')
    act(() => renderer?.unmount())
    renderer = null
    const again = render({ file: twoHunks(), onRevertHunk, revertScope: 'msg-2:0:0' })
    expect(texts(again.root)).not.toContain('Reverted')
    expect(buttons(again.root)).toHaveLength(2)
  })

  it('does not carry a mark from one file onto another card with the same rows', async () => {
    const { onRevertHunk } = handlerThat({ status: 'reverted', removed: 1, restored: 1 })
    const first = render({ file: twoHunks(), onRevertHunk })
    await act(async () => {
      buttons(first.root)[0]!.props.onPress()
    })
    act(() => renderer?.unmount())
    renderer = null
    const other = render({ file: twoHunks({ path: '/w/src/other.ts' }), onRevertHunk })
    expect(texts(other.root)).not.toContain('Reverted')
    expect(buttons(other.root)).toHaveLength(2)
  })

  it('offers nothing on a created or deleted file: that hunk is the whole file', () => {
    const { onRevertHunk } = handlerThat({ status: 'reverted', removed: 1, restored: 1 })
    expect(buttons(render({ file: twoHunks({ changeKind: 'added' }), onRevertHunk }).root)).toHaveLength(0)
    act(() => renderer?.unmount())
    renderer = null
    expect(buttons(render({ file: twoHunks({ changeKind: 'deleted' }), onRevertHunk }).root)).toHaveLength(0)
  })

  it('offers nothing on a hunk the card clipped past its row limit', () => {
    const { onRevertHunk } = handlerThat({ status: 'reverted', removed: 1, restored: 1 })
    // Five rows: the first hunk (rows 1–2) is fully drawn; the second (row 6) is not.
    const tree = render({ file: twoHunks(), onRevertHunk, rowLimit: 5 })
    expect(buttons(tree.root)).toHaveLength(1)
  })

  it('offers nothing on a card with no hunks at all', () => {
    const { onRevertHunk } = handlerThat({ status: 'reverted', removed: 1, restored: 1 })
    const contextOnly = finalizeEditFile({
      path: '/w/f',
      oldPath: null,
      changeKind: 'edited',
      lineNumbersKnown: true,
      lines: [ctx('a', 1, 1)]
    })
    expect(buttons(render({ file: contextOnly, onRevertHunk }).root)).toHaveLength(0)
  })

  it('colours the action for the theme in use, in light and in dark', () => {
    const { onRevertHunk } = handlerThat({ status: 'reverted', removed: 1, restored: 1 })
    const colourOf = (root: ReactTestInstance) => {
      const label = root
        .findAllByType('Text' as never)
        .find((node) => node.props.children === 'Revert this hunk')
      const style = [label?.props.style].flat(3).find((entry) => entry && typeof entry === 'object')
      return (style as { color?: string } | undefined)?.color
    }
    const light = colourOf(render({ file: twoHunks(), onRevertHunk }).root)
    act(() => renderer?.unmount())
    renderer = null
    const dark = colourOf(render({ file: twoHunks(), onRevertHunk }, 'dark').root)
    expect(light).toBe(lightColors.accentText)
    expect(dark).toBe(darkColors.accentText)
    expect(light).not.toBe(dark)
  })
})
