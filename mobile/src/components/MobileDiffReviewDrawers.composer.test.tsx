// The comment composer of the Changes review screen, in the Claude app's words (`px20.d`,
// `jjc`, `jl8` case 19 in com.anthropic.claude 1.261009.20): a "Line N" caption, a field that asks
// "Tell Claude what to change", "Cancel", and "Add comment" or "Save comment". Both themes.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../../src/shared/diff-comment-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'

vi.mock('react-native', () => ({
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Copy: 'Copy',
  FileText: 'FileText',
  Plus: 'Plus',
  Send: 'Send',
  Trash2: 'Trash2',
  X: 'X'
}))
vi.mock('./ActionSheetModal', () => ({ ActionSheetModal: () => null }))
vi.mock('./ConfirmModal', () => ({ ConfirmModal: () => null }))
vi.mock('./BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: unknown }) =>
    visible ? createElement('BottomDrawer', null, children as never) : null
}))
vi.mock('../platform/keyboard-occlusion', () => ({ useKeyboardAvoidingPadding: () => 0 }))

const { MobileDiffReviewDrawers } = await import('./MobileDiffReviewDrawers')

type Controller = Parameters<typeof MobileDiffReviewDrawers>[0]['controller']

const COMMENT: DiffComment = {
  id: 'c1',
  worktreeId: 'w1',
  filePath: 'src/a.ts',
  lineNumber: 12,
  body: 'Rename this',
  createdAt: 1,
  side: 'modified'
}

function styleOf(node: { props: { style?: unknown } }, pressed = false): Record<string, unknown> {
  const raw =
    typeof node.props.style === 'function' ? node.props.style({ pressed }) : node.props.style
  const flat = (Array.isArray(raw) ? raw.flat(3) : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

describe('the comment composer', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    scheme: 'light' | 'dark',
    composer: Controller['composer'],
    composerBody: string
  ) {
    const controller = {
      composer,
      composerBody,
      setComposerBody: vi.fn(),
      closeComposer: vi.fn(),
      saveComposer: vi.fn().mockResolvedValue(undefined),
      deleteComment: vi.fn().mockResolvedValue(undefined),
      showOverflow: false,
      setShowOverflow: vi.fn(),
      sendSheet: null,
      closeSendSheet: vi.fn(),
      discardTarget: null,
      setDiscardTarget: vi.fn(),
      showCompletion: false,
      setShowCompletion: vi.fn(),
      unsentComments: [],
      reviewedUnstagedCount: 0,
      notesSending: null,
      screenState: { kind: 'loading' },
      queue: []
    } as unknown as Controller
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileDiffReviewDrawers controller={controller} />
        </ThemeProvider>
      )
    })
    return controller
  }

  function text(label: string) {
    return renderer!.root
      .findAllByType('Text' as never)
      .find((node) => [node.props.children].flat().join('') === label)
  }

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('asks "Tell Claude what to change" in the field, muted, in %s', (scheme, colors) => {
    render(scheme, { mode: 'create', lineNumber: 12 }, '')
    const field = renderer!.root.findByType('TextInput' as never)
    expect(field.props.placeholder).toBe('Tell Claude what to change')
    expect(field.props.placeholderTextColor).toBe(colors.composerPlaceholder)
    expect(styleOf(field)).toMatchObject({ color: colors.text, fontSize: 17 })
  })

  it('names the field for the line being commented on, as the app does', () => {
    render('light', { mode: 'create', lineNumber: 12 }, '')
    expect(renderer!.root.findByType('TextInput' as never).props.accessibilityLabel).toBe(
      'Comment on line 12'
    )
    expect(text('Line 12')).toBeDefined()
  })

  it('names an edited comment\'s line from the comment', () => {
    render('light', { mode: 'edit', comment: COMMENT }, 'Rename this')
    expect(renderer!.root.findByType('TextInput' as never).props.accessibilityLabel).toBe(
      'Comment on line 12'
    )
    expect(text('Line 12')).toBeDefined()
  })

  it('calls a note on the whole file a file note, since it has no line', () => {
    render('light', { mode: 'create', lineNumber: 0 }, '')
    expect(renderer!.root.findByType('TextInput' as never).props.accessibilityLabel).toBe(
      'File note'
    )
    expect(text('File note')).toBeDefined()
  })

  it('offers "Add comment" for a new comment and "Save comment" for an edit', () => {
    render('light', { mode: 'create', lineNumber: 12 }, 'Words')
    expect(text('Add comment')).toBeDefined()
    expect(text('Save comment')).toBeUndefined()
    act(() => renderer?.unmount())
    render('light', { mode: 'edit', comment: COMMENT }, 'Words')
    expect(text('Save comment')).toBeDefined()
    expect(text('Add comment')).toBeUndefined()
  })

  it('leaves the button off until there are words, and presses it with them', () => {
    const empty = render('light', { mode: 'create', lineNumber: 12 }, '   ')
    const button = renderer!.root.findByProps({ accessibilityLabel: 'Add comment' })
    expect(button.props.disabled).toBe(true)
    expect(empty.saveComposer).not.toHaveBeenCalled()
    act(() => renderer?.unmount())

    const full = render('light', { mode: 'create', lineNumber: 12 }, 'Do this')
    const live = renderer!.root.findByProps({ accessibilityLabel: 'Add comment' })
    expect(live.props.disabled).toBe(false)
    act(() => live.props.onPress())
    expect(full.saveComposer).toHaveBeenCalledTimes(1)
  })

  it('has a Cancel that closes it', () => {
    const controller = render('dark', { mode: 'create', lineNumber: 12 }, 'Do this')
    expect(text('Cancel')).toBeDefined()
    const cancel = renderer!.root.findByProps({ accessibilityLabel: 'Cancel comment' })
    act(() => cancel.props.onPress())
    expect(controller.closeComposer).toHaveBeenCalledTimes(1)
  })

  it('offers Delete only on a comment that exists', () => {
    render('light', { mode: 'create', lineNumber: 12 }, '')
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'Delete comment' })).toHaveLength(0)
    act(() => renderer?.unmount())

    const controller = render('light', { mode: 'edit', comment: COMMENT }, 'Rename this')
    const del = renderer!.root.findByProps({ accessibilityLabel: 'Delete comment' })
    expect(text('Delete')).toBeDefined()
    act(() => del.props.onPress())
    expect(controller.deleteComment).toHaveBeenCalledTimes(1)
  })

  it('draws no composer while none is open', () => {
    render('light', null, '')
    expect(renderer!.root.findAllByType('TextInput' as never)).toHaveLength(0)
  })

  it('no longer titles the sheet "Add Note" or "Edit Note"', () => {
    render('light', { mode: 'create', lineNumber: 12 }, '')
    expect(text('Add Note')).toBeUndefined()
    expect(text('Edit Note')).toBeUndefined()
  })
})
