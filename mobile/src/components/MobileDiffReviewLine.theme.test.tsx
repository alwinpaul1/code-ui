// A single diff line, in both themes, as the Claude app draws one (`jlc.c` in com.anthropic.claude
// 1.261009.20): the row tinted green or red from the app's own diff colours, a 1 dp bar at its left
// edge, a gutter reading "+12", "-8" or "12" in 13 sp mono with a hairline after it, the code 10 dp
// further on in 14 sp, a yellow or brown row when the line carries a comment, and the whole row
// one tap to comment on it.
//
// Before the theme-review fix this file kept its own module-level StyleSheet.create built from the
// static dark palette, so the added/deleted row tints stayed dark-palette colours on a light
// session. The tints come from `mobile-diff-claude-palette.ts` by scheme now, which is what this
// pins for every row kind.

import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import { mobileDiffPaletteForScheme } from '../source-control/mobile-diff-claude-palette'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import type { MobileDiffLine } from '../session/mobile-diff-lines'
import type { MobileHighlightedDiffLine } from '../session/mobile-file-syntax'
import { MobileDiffReviewLine } from './MobileDiffReviewLine'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  Pencil: 'Pencil',
  Trash2: 'Trash2',
  ChevronDown: 'ChevronDown',
  ChevronUp: 'ChevronUp',
  UnfoldVertical: 'UnfoldVertical'
}))
vi.mock('../ui/tap-target', () => ({ tapTargetHitSlop: () => undefined }))
vi.mock('./MobileSyntaxSegments', () => ({ MobileSyntaxSegments: () => null }))

function styleOf(node: { props: { style?: unknown } }, pressed = false): Record<string, unknown> {
  const raw =
    typeof node.props.style === 'function' ? node.props.style({ pressed }) : node.props.style
  const flat = (Array.isArray(raw) ? raw.flat(3) : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

function line(kind: MobileDiffLine['kind']): MobileHighlightedDiffLine<MobileDiffLine> {
  return {
    kind,
    text: 'const x = 1',
    newLineNumber: kind === 'delete' ? undefined : 7,
    oldLineNumber: kind === 'add' ? undefined : 7,
    segments: [],
    highlighted: false
  }
}

const COMMENT: DiffComment = {
  id: 'c1',
  worktreeId: 'w1',
  filePath: 'src/a.ts',
  lineNumber: 7,
  body: 'Name this better',
  createdAt: 1,
  side: 'modified'
}

describe('a diff review line', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    scheme: 'light' | 'dark',
    overrides: Partial<Parameters<typeof MobileDiffReviewLine>[0]> = {}
  ) {
    const onAddNote = vi.fn()
    const onEditNote = vi.fn()
    const onDeleteNote = vi.fn()
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileDiffReviewLine
            line={line('context')}
            comments={[]}
            staleCommentIds={new Set()}
            active={false}
            gutterWidth={37}
            onAddNote={onAddNote}
            onEditNote={onEditNote}
            onDeleteNote={onDeleteNote}
            {...overrides}
          />
        </ThemeProvider>
      )
    })
    return { onAddNote, onEditNote, onDeleteNote }
  }

  function rowOf() {
    return renderer!.root.findAllByType('Pressable' as never)[0]!
  }

  it.each(['light', 'dark'] as const)('paints an added row from the app\'s %s add tint', (scheme) => {
    const palette = mobileDiffPaletteForScheme(scheme)
    render(scheme, { line: line('add') })
    expect(styleOf(rowOf()).backgroundColor).toBe(palette.addBg)
  })

  it.each(['light', 'dark'] as const)('paints a deleted row from the app\'s %s delete tint', (scheme) => {
    const palette = mobileDiffPaletteForScheme(scheme)
    render(scheme, { line: line('delete') })
    expect(styleOf(rowOf()).backgroundColor).toBe(palette.delBg)
  })

  it.each(['light', 'dark'] as const)('leaves an unchanged row on the page, with no bar', (scheme) => {
    render(scheme)
    expect(styleOf(rowOf()).backgroundColor).toBeUndefined()
    expect(
      renderer!.root
        .findAllByType('View' as never)
        .filter((node) => styleOf(node).position === 'absolute')
    ).toHaveLength(0)
  })

  it.each([
    ['light', 'add', 'addMarker'],
    ['dark', 'add', 'addMarker'],
    ['light', 'delete', 'delMarker'],
    ['dark', 'delete', 'delMarker']
  ] as const)('draws a 1 dp %s %s bar at the left edge', (scheme, kind, token) => {
    render(scheme, { line: line(kind) })
    const bar = renderer!.root
      .findAllByType('View' as never)
      .find((node) => styleOf(node).position === 'absolute')
    expect(styleOf(bar!)).toMatchObject({
      width: 1,
      left: 0,
      backgroundColor: mobileDiffPaletteForScheme(scheme)[token]
    })
  })

  it.each([
    ['add', '+7'],
    ['delete', '-7'],
    ['context', '7']
  ] as const)('reads a %s row\'s gutter as "%s", 13 sp mono, left aligned', (kind, label) => {
    render('light', { line: line(kind), gutterWidth: 45 })
    const gutter = renderer!.root.findByProps({ children: label })
    expect(styleOf(gutter)).toMatchObject({
      fontSize: 13,
      lineHeight: 19.5,
      textAlign: 'left',
      color: lightColors.text
    })
    const cell = gutter.parent!
    expect(styleOf(cell)).toMatchObject({
      width: 45,
      borderRightWidth: 1,
      borderRightColor: lightColors.composerBorder
    })
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('sets the code in 14 sp, %s, 10 dp after the divider', (_scheme, colors) => {
    render(_scheme)
    const code = renderer!.root.findAllByType('Text' as never).find((node) => styleOf(node).fontSize === 14)
    expect(code).toBeDefined()
    expect(styleOf(code!)).toMatchObject({ color: colors.text, lineHeight: 19.5 })
    expect(styleOf(code!.parent!).paddingLeft).toBe(10)
  })

  it.each(['light', 'dark'] as const)(
    'turns a row that carries a comment to the app\'s highlight, over its add tint (%s)',
    (scheme) => {
      const palette = mobileDiffPaletteForScheme(scheme)
      render(scheme, { line: line('add'), comments: [COMMENT] })
      expect(styleOf(rowOf()).backgroundColor).toBe(palette.commentedBg)
      // The bar still says it is an added line.
      const bar = renderer!.root
        .findAllByType('View' as never)
        .find((node) => styleOf(node).position === 'absolute')
      expect(styleOf(bar!).backgroundColor).toBe(palette.addMarker)
    }
  )

  it('mutes the number of an unchanged row that carries a comment, as the app does', () => {
    render('dark', { comments: [COMMENT] })
    const gutter = renderer!.root.findByProps({ children: '7' })
    expect(styleOf(gutter).color).toBe(darkColors.composerPlaceholder)
  })

  it('draws a card under the row for each comment on it', () => {
    render('light', { comments: [COMMENT, { ...COMMENT, id: 'c2', body: 'And this' }] })
    expect(renderer!.root.findAllByProps({ children: 'Line 7' })).toHaveLength(2)
    expect(renderer!.root.findByProps({ children: 'Name this better' })).toBeDefined()
    expect(renderer!.root.findByProps({ children: 'And this' })).toBeDefined()
  })

  it('is one tap to comment on the line, named as the app names it', () => {
    const { onAddNote } = render('light')
    const row = rowOf()
    expect(row.props.accessibilityRole).toBe('button')
    expect(row.props.accessibilityHint).toBe('Comment on this line')
    expect(row.props.accessibilityLabel).toBe('7, const x = 1')
    act(() => row.props.onPress())
    expect(onAddNote).toHaveBeenCalledWith(7)
  })

  it('tells a screen reader an added row was added and a deleted row removed', () => {
    render('light', { line: line('add') })
    expect(rowOf().props.accessibilityValue).toEqual({ text: 'Added' })
    act(() => renderer?.unmount())
    render('light', { line: line('delete') })
    expect(rowOf().props.accessibilityValue).toEqual({ text: 'Removed' })
  })

  it('cannot be commented on when it is a deleted row: notes anchor to the modified side', () => {
    const { onAddNote } = render('light', { line: line('delete') })
    const row = rowOf()
    expect(row.props.disabled).toBe(true)
    expect(row.props.accessibilityRole).toBe('text')
    expect(row.props.accessibilityHint).toBeUndefined()
    expect(onAddNote).not.toHaveBeenCalled()
  })

  it('draws a blank line as its gutter alone, with the label a screen reader needs', () => {
    render('light', { line: { ...line('context'), text: '' } })
    expect(rowOf().props.accessibilityLabel).toBe('7')
  })

  it('keeps the active hunk\'s accent edge', () => {
    render('light', { line: line('add'), active: true })
    expect(styleOf(rowOf())).toMatchObject({ borderLeftWidth: 2, borderLeftColor: lightColors.accent })
  })

  it('draws a folded run the mobile cap left as a fold row with no tap target', () => {
    const folded: MobileHighlightedDiffLine<MobileDiffLine> = {
      kind: 'context',
      text: '2,896 unchanged lines',
      note: { kind: 'collapsed', hiddenLines: 2_896 },
      segments: [],
      highlighted: false
    }
    render('dark', { line: folded })
    expect(renderer!.root.findAllByType('Pressable' as never)).toHaveLength(0)
    expect(renderer!.root.findByProps({ children: '+2,896 lines' })).toBeDefined()
  })
})
