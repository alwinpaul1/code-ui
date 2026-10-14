// A saved comment under its line, as the Claude app's `px20.c` draws it (com.anthropic.claude
// 1.261009.20): a rounded card with a hairline, "Line N" in muted text, the words, and Edit and
// Delete. Both schemes, from tokens.

import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileDiffCommentCard } from './MobileDiffCommentCard'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ Pencil: 'Pencil', Trash2: 'Trash2' }))
vi.mock('../ui/tap-target', () => ({ tapTargetHitSlop: () => undefined }))

function styleOf(node: { props: { style?: unknown } }, pressed = false): Record<string, unknown> {
  const raw =
    typeof node.props.style === 'function' ? node.props.style({ pressed }) : node.props.style
  const flat = (Array.isArray(raw) ? raw.flat(3) : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

const COMMENT: DiffComment = {
  id: 'c1',
  worktreeId: 'w1',
  filePath: 'src/a.ts',
  lineNumber: 42,
  body: 'Rename this to retryCount',
  createdAt: 1,
  side: 'modified'
}

describe('a saved comment under its line', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    scheme: 'light' | 'dark',
    overrides: Partial<Parameters<typeof MobileDiffCommentCard>[0]> = {}
  ) {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileDiffCommentCard
            comment={COMMENT}
            stale={false}
            onEdit={onEdit}
            onDelete={onDelete}
            {...overrides}
          />
        </ThemeProvider>
      )
    })
    return { onEdit, onDelete }
  }

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the card, its caption and its words from the %s theme', (_scheme, colors) => {
    render(_scheme)

    const card = renderer!.root.findAllByType('View' as never)[0]!
    expect(styleOf(card)).toMatchObject({
      backgroundColor: colors.attachmentCardFill,
      borderColor: colors.composerBorder,
      borderWidth: 0.5,
      borderRadius: 24
    })
    const caption = renderer!.root.findByProps({ children: 'Line 42' })
    expect(styleOf(caption)).toMatchObject({ color: colors.composerPlaceholder, fontSize: 13 })
    const body = renderer!.root.findByProps({ children: 'Rename this to retryCount' })
    expect(styleOf(body).color).toBe(colors.text)
  })

  it('names its two buttons Edit and Delete, and tells a screen reader which comment', () => {
    const { onEdit, onDelete } = render('light')

    const buttons = renderer!.root.findAllByType('Pressable' as never)
    const labels = buttons.map((node) => node.props.accessibilityLabel)
    expect(labels).toContain('Edit comment')
    expect(labels).toContain('Delete comment')
    expect(renderer!.root.findByProps({ children: 'Edit' })).toBeDefined()
    expect(renderer!.root.findByProps({ children: 'Delete' })).toBeDefined()

    act(() => buttons.find((n) => n.props.accessibilityLabel === 'Delete comment')!.props.onPress())
    expect(onDelete).toHaveBeenCalledWith(COMMENT)
    expect(onEdit).not.toHaveBeenCalled()
    act(() => buttons.find((n) => n.props.accessibilityLabel === 'Edit comment')!.props.onPress())
    expect(onEdit).toHaveBeenCalledWith(COMMENT)
  })

  // Review of 302aa95f8: the words' tap target was also named "Edit comment" and carried the
  // comment as a hint, so a screen reader said "Edit comment" twice and a reader with hints off
  // never heard the words.
  it('names the tap target of the words by the words, and says what a tap does as its hint', () => {
    render('light')
    const body = renderer!.root.findByProps({ children: 'Rename this to retryCount' })
    let node = body.parent
    while (node && String(node.type) !== 'Pressable') {
      node = node.parent
    }
    expect(node!.props.accessibilityLabel).toBe('Rename this to retryCount')
    expect(node!.props.accessibilityHint).toBe('Edit comment')
    const labels = renderer!.root
      .findAllByType('Pressable' as never)
      .map((pressable) => pressable.props.accessibilityLabel)
    expect(labels.filter((label) => label === 'Edit comment')).toHaveLength(1)
  })

  it('opens for editing from a tap on the words too', () => {
    const { onEdit } = render('dark')
    const body = renderer!.root.findByProps({ children: 'Rename this to retryCount' })
    // The words sit inside a tap target of their own.
    let node = body.parent
    while (node && String(node.type) !== 'Pressable') {
      node = node.parent
    }
    expect(node).not.toBeNull()
    act(() => node!.props.onPress())
    expect(onEdit).toHaveBeenCalledWith(COMMENT)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('says a stale comment is stale, in the %s warning colour', (scheme, colors) => {
    render(scheme, { stale: true })
    const stale = renderer!.root.findByProps({ children: 'Stale' })
    expect(styleOf(stale).color).toBe(colors.warning)
  })

  it('says nothing of staleness for a comment that is current', () => {
    render('light')
    expect(renderer!.root.findAllByProps({ children: 'Stale' })).toHaveLength(0)
  })

  it('draws a comment with no words as a card with the caption and the buttons', () => {
    render('light', { comment: { ...COMMENT, body: '' } })
    expect(renderer!.root.findByProps({ children: 'Line 42' })).toBeDefined()
    expect(renderer!.root.findAllByProps({ children: 'Rename this to retryCount' })).toHaveLength(0)
  })
})
