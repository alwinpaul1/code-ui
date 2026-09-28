import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'
import { ChatTextSelectableContext } from './chat-text-selectable-context'

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

// One document carrying every block the agent writes that a reader would want
// to lift verbatim — a command out of a fence, a cell out of a table.
const DOCUMENT = [
  '## What changed',
  '',
  'Two safety details. First, the total cannot go below zero.',
  '',
  '> The lock file resolves differently in the image.',
  '',
  '```sh',
  'pnpm install --frozen-lockfile',
  '```',
  '',
  '| Stage | Resolver |',
  '| --- | --- |',
  '| base | pip |',
  '',
  '- run the suite inside the image'
].join('\n')

describe('agent prose the reader wants to copy', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function textsBySelectability(): { selectable: string[]; fixed: string[] } {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content: DOCUMENT }))
    })
    const selectable: string[] = []
    const fixed: string[] = []
    // A span nested in a selectable Text is selectable with it.
    const inSelectable = (node: ReactTestInstance | null): boolean =>
      node != null && (node.props.selectable === true || inSelectable(node.parent))
    for (const node of renderer!.root.findAllByType('Text' as never)) {
      const text = node.children
        .map((child) => (typeof child === 'string' ? child : ''))
        .join('')
        .trim()
      if (!text) {
        continue
      }
      ;(inSelectable(node) ? selectable : fixed).push(text)
    }
    return { selectable, fixed }
  }

  it('lets the reader select a paragraph — the answer itself, not only its table', () => {
    // Why: reported 2026-09-11 from a tablet with a video — a long press on
    // an answer's prose selected nothing while its table did. Every other
    // block was selectable; the paragraph was the one left out.
    const { selectable, fixed } = textsBySelectability()
    expect(selectable.some((text) => text.includes('Two safety details'))).toBe(true)
    expect(fixed.some((text) => text.includes('Two safety details'))).toBe(false)
  })

  it('lets one selection span neighbouring paragraphs and their heading', () => {
    // Why: Android confines a selection to one Text; with a Text per
    // paragraph the reader could select a paragraph but never the next one
    // (2026-09-12, screenshot). Consecutive prose is one selectable Text.
    act(() => {
      renderer = create(
        createElement(MobileMarkdown, {
          content: ['## Cause', '', 'First paragraph here.', '', 'Second paragraph here.'].join('\n')
        })
      )
    })
    const selectableTexts = renderer!.root
      .findAllByType('Text' as never)
      .filter((node) => node.props.selectable === true)
    expect(selectableTexts).toHaveLength(1)
    const flat = selectableTexts[0]!
      .findAll(() => true)
      .flatMap((node) => node.children)
      .filter((child): child is string => typeof child === 'string')
      .join('')
    expect(flat).toContain('Cause')
    expect(flat).toContain('First paragraph here.')
    expect(flat).toContain('Second paragraph here.')
  })

  it('lets one selection cross a rule and an image on its way to the next section', () => {
    // Why: reported 2026-09-19 with a screenshot of thesis_explained.md — the
    // selection ran from one paragraph through the heading below it and
    // stopped dead before "## 4. CKA, the new score". Between them the source
    // has a `---` and, after the heading, `![CKA twins](fig/fig3_cka.svg)`.
    // Both were their own View, so the prose on either side was two Texts and
    // Android would not let a selection cross. Lines are from that file.
    act(() => {
      renderer = create(
        createElement(MobileMarkdown, {
          content: [
            '### Extra checks added on the way',
            '',
            "The sweep's \"10 epochs\" were really 500-batch rounds, none retraining from scratch.",
            '',
            '---',
            '',
            '## 4. CKA, the new score, in plain words',
            '',
            '![CKA twins](fig/fig3_cka.svg)',
            '',
            'Take the trained model. Make two copies by copying the weights, no training.'
          ].join('\n')
        })
      )
    })
    const selectableTexts = renderer!.root
      .findAllByType('Text' as never)
      .filter((node) => node.props.selectable === true)
    expect(selectableTexts).toHaveLength(1)
    const flat = selectableTexts[0]!
      .findAll(() => true)
      .flatMap((node) => node.children)
      .filter((child): child is string => typeof child === 'string')
      .join('')
    expect(flat).toContain('none retraining from scratch.')
    expect(flat).toContain('4. CKA, the new score, in plain words')
    expect(flat).toContain('CKA twins')
    expect(flat).toContain('Take the trained model.')
  })

  it('lets one selection run from a paragraph through the list under it and on', () => {
    // Why: reported 2026-09-19 with a screenshot of the phone — a long press
    // on "Stopped. State of things:" selected down to "Checked on the device:"
    // and the handle would not drag into the bullets below it. Each list item
    // was its own Text in a row View, so the paragraph run ended at the list.
    // The list now joins the run as spans. A quote did too until 2026-09-24,
    // when its per-line bar broke on every wrap; it is its own block again,
    // selectable on its own. Lines are from that screen.
    act(() => {
      renderer = create(
        createElement(MobileMarkdown, {
          content: [
            'Stopped. State of things:',
            '',
            'The build on the phone now (0.8.0, versionCode 233, no bump) has the chip fix and the stale-queue fix. Checked on the device:',
            '',
            '- Queue box is empty of the old stale entries.',
            '- A phone send while I was working showed in the box within a second and left it when the turn took it.',
            '',
            '> The row it writes is pinned by a test using the real transcript row.',
            '',
            'Not checked live: tapping **Send now** on the phone.'
          ].join('\n')
        })
      )
    })
    const selectableTexts = renderer!.root
      .findAllByType('Text' as never)
      .filter((node) => node.props.selectable === true)
    // The paragraphs and the list, then the quote, then the closing line.
    expect(selectableTexts).toHaveLength(3)
    // In reading order, spans included: what a copy of the selection carries.
    const inOrder = (node: ReactTestInstance): string =>
      node.children
        .map((child) => (typeof child === 'string' ? child : inOrder(child)))
        .join('')
    const flat = inOrder(selectableTexts[0]!)
    expect(flat).toContain('Checked on the device:')
    expect(flat).toContain('left it when the turn took it.')
    // The bullets are still bullets when copied, a blank line between items
    // since they have the Claude app's gap between them (2026-09-28).
    expect(flat).toMatch(/•\s+Queue box is empty of the old stale entries\.\n\n\s*•\s+A phone send/)
    expect(inOrder(selectableTexts[1]!)).toBe('The row it writes is pinned by a test using the real transcript row.')
    expect(inOrder(selectableTexts[2]!)).toContain('Not checked live: tapping Send now on the phone.')
  })

  it('starts a new run at a heading once the run behind it is long, and not before', () => {
    // Device 2026-09-19, three screenshots of thesis_explained.md: with
    // lists, quotes and figures inside the run, the whole document became
    // one Text and Android drew every code chip in it a line off, over the
    // prose. Cut into sections (a build that broke runs at every heading)
    // the chips sat where they belong. A short section still joins the next
    // one, so the earlier report — a selection stopping dead before
    // "## 4. CKA" — stays fixed.
    const paragraph = (n: number) => `${'word '.repeat(120)}${n}.`
    const long = ['## One', '', paragraph(1), '', paragraph(2), '', paragraph(3), '', paragraph(4), '', paragraph(5), '', paragraph(6)]
    act(() => {
      renderer = create(
        createElement(MobileMarkdown, {
          content: [...long, '', '## Two', '', 'short section', '', '## Three', '', 'after a short one'].join('\n')
        })
      )
    })
    const runs = renderer!.root
      .findAllByType('Text' as never)
      .filter((node) => node.props.selectable === true)
    const inOrder = (node: ReactTestInstance): string =>
      node.children
        .map((child) => (typeof child === 'string' ? child : inOrder(child)))
        .join('')
    expect(runs).toHaveLength(2)
    // The long section is its own run; the two short ones share the next.
    expect(inOrder(runs[0]!)).toContain('One')
    expect(inOrder(runs[0]!)).not.toContain('Two')
    expect(inOrder(runs[1]!)).toContain('Two')
    expect(inOrder(runs[1]!)).toContain('Three')
    expect(inOrder(runs[1]!)).toContain('after a short one')
  })

  it('lets the reader select a heading, a quote, a fence, a table cell and a list item', () => {
    const { selectable } = textsBySelectability()
    expect(selectable).toContain('What changed')
    expect(selectable).toContain('The lock file resolves differently in the image.')
    expect(selectable).toContain('pnpm install --frozen-lockfile')
    expect(selectable).toContain('Stage')
    expect(selectable).toContain('base')
    expect(selectable).toContain('run the suite inside the image')
  })
})

// 2026-09-12: random buzzes while scrolling. Android arms a text-selection
// long-press under any selectable Text; a finger put down to stop a fling and
// held tripped it. The chat view turns selection off while a scroll is in
// flight, through this context, and back on when it settles.
describe('while the list is scrolling', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function selectableTexts(value: boolean): { all: number; selectable: number } {
    act(() => {
      renderer = create(
        createElement(
          ChatTextSelectableContext.Provider,
          { value },
          createElement(MobileMarkdown, { content: DOCUMENT })
        )
      )
    })
    const texts = renderer!.root.findAllByType('Text' as never)
    return { all: texts.length, selectable: texts.filter((node) => node.props.selectable === true).length }
  }

  it('renders no selectable text, so a finger stopping a fling arms no long-press', () => {
    const { all, selectable } = selectableTexts(false)
    expect(all).toBeGreaterThan(5)
    expect(selectable).toBe(0)
  })

  it('is selectable again once the scroll settles', () => {
    expect(selectableTexts(true).selectable).toBeGreaterThan(0)
  })
})

// A hold on inline code selected nothing, mid-turn or not (2026-09-25: the
// reader holds prose with a pill in it and wants the Claude app's Copy).
// The pill is a View drawn over the prose, and on Android a React view
// consumes every touch that lands on it (ReactViewGroup.onTouchEvent), so
// the prose Text under it never sees the hold. The pill's own Text is a
// separate native view (the View breaks the text ancestry), so it is the
// one that has to be selectable. What only the device shows: Android
// selecting inside the pill, with handles and Copy / Select all.
describe('holding a code pill', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function pillTexts(
    content: string,
    selectable: boolean,
    onOpenFile?: (path: string) => void
  ): ReactTestInstance[] {
    act(() => {
      renderer = create(
        createElement(
          ChatTextSelectableContext.Provider,
          { value: selectable },
          createElement(MobileMarkdown, { content, onOpenFile })
        )
      )
    })
    // A pill is a View whose nearest host ancestor is a Text; the Text inside
    // it is its own native text view. Components between them are skipped.
    const hostParent = (node: ReactTestInstance): ReactTestInstance | null => {
      let parent = node.parent
      while (parent && typeof parent.type !== 'string') {
        parent = parent.parent
      }
      return parent
    }
    return renderer!.root
      .findAll((node) => node.type === ('View' as never) && hostParent(node)?.type === ('Text' as never))
      .map((pill) => pill.findByType('Text' as never))
  }

  it('selects the code inside the pill, as the prose around it does', () => {
    const [pill] = pillTexts('Run `pnpm install --frozen-lockfile` from the repo root.', true)
    expect(pill!.children.join('')).toBe('pnpm install --frozen-lockfile')
    expect(pill!.props.selectable).toBe(true)
  })

  it('selects a pill in a bullet and in a table cell too', () => {
    const pills = pillTexts(
      ['- run `orca search` on the desktop', '', '| Stage | Resolver |', '| --- | --- |', '| base | `pip` |'].join('\n'),
      true
    )
    expect(pills.map((pill) => [pill.children.join(''), pill.props.selectable])).toEqual([
      ['orca search', true],
      ['pip', true]
    ])
  })

  it('still opens a file named in a pill on a tap, and selects it on a hold', () => {
    const opened: string[] = []
    const [pill] = pillTexts('See `mobile/src/session/use-mobile-chat-following.ts` for the rule.', true, (path) =>
      opened.push(path)
    )
    expect(pill!.props.selectable).toBe(true)
    act(() => pill!.props.onPress())
    expect(opened).toEqual(['mobile/src/session/use-mobile-chat-following.ts'])
  })

  it('is not selectable while a fling is in flight, the 2026-09-12 rule', () => {
    const [pill] = pillTexts('Run `pnpm install` from the repo root.', false)
    expect(pill!.props.selectable).toBe(false)
  })
})

// A hold to copy a link, a named file or a file pill also opened it when the
// finger lifted (second review, 2026-09-25). Android starts its selection on
// the hold, and React Native still fires the Text's onPress on the release
// unless the Text has an onLongPress to cancel the press (Pressability; the
// rule is pinned in chat-text-selectable-host.test.ts). Text takes no
// delayLongPress, so the press counts as long at 500 ms, and a hold released
// between Android's 400 ms and that still opens: only the phone shows it.
describe('holding a link to copy it', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('does not open a link, a named file or a file pill on the release of a hold, and still opens each on a tap', () => {
    const opened: string[] = []
    act(() => {
      renderer = create(
        createElement(MobileMarkdown, {
          content: [
            'See https://example.com/docs and [the guide](https://example.com/guide).',
            '',
            'The rule is in mobile/src/session/use-mobile-chat-following.ts, and',
            '`docs/hud.md` draws it.'
          ].join('\n'),
          onOpenFile: (path: string) => opened.push(path)
        })
      )
    })
    const pressable = renderer!.root
      .findAllByType('Text' as never)
      .filter((node) => typeof node.props.onPress === 'function')
    const labels = pressable.map((node) => node.children.join(''))
    expect(labels).toEqual([
      'https://example.com/docs',
      'the guide',
      'mobile/src/session/use-mobile-chat-following.ts',
      'docs/hud.md'
    ])
    for (const node of pressable) {
      expect({ label: node.children.join(''), cancelsPressOnHold: typeof node.props.onLongPress }).toEqual({
        label: node.children.join(''),
        cancelsPressOnHold: 'function'
      })
      act(() => node.props.onLongPress())
    }
    // The hold itself opened nothing; a tap still does.
    expect(opened).toEqual([])
    act(() => pressable[2]!.props.onPress())
    act(() => pressable[3]!.props.onPress())
    expect(opened).toEqual(['mobile/src/session/use-mobile-chat-following.ts', 'docs/hud.md'])
  })
})
