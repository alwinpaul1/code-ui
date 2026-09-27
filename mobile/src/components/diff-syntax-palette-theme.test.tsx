import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Syntax colours on every diff row, in both themes. `MobileSyntaxSegments` took its palette as an
 * optional prop defaulting to Dark+ ("for the surfaces still painted from the static dark
 * palette"), and five diff rows never passed one: the session diff tab, the diff-comment row, the
 * Changes review screen, source control's committed-diff drawer and a pull request's file diff in
 * Tasks. Their rows had moved to the live theme, so in a light session Dark+ keyword blue #569cd6,
 * string orange #ce9178 and variable blue #9cdcfe sat on a light code background. The palette is
 * required now; each row passes `useTheme().syntax`.
 */

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  Pressable: 'Pressable',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ MessageSquare: 'Icon', Plus: 'Icon', X: 'Icon' }))
vi.mock('./BottomDrawer', () => ({
  BottomDrawer: ({ children }: { children: unknown }) => createElement('BottomDrawer', null, children as never)
}))
// The tasks barrel re-exports half the app; the PR diff needs only these.
vi.mock('../tasks/mobile-tasks-dependencies', async () => {
  const react = await vi.importActual<typeof import('react')>('react')
  const theme = await vi.importActual<typeof import('../theme/mobile-theme')>('../theme/mobile-theme')
  const syntax = await vi.importActual<typeof import('../session/mobile-file-syntax')>(
    '../session/mobile-file-syntax'
  )
  const segments = await vi.importActual<typeof import('./MobileSyntaxSegments')>('./MobileSyntaxSegments')
  const prDiff = await vi.importActual<typeof import('../tasks/github-pr-file-diff')>(
    '../tasks/github-pr-file-diff'
  )
  return {
    ...theme,
    useMemo: react.useMemo,
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
    StyleSheet: { create: (s: unknown) => s },
    MobileSyntaxSegments: segments.MobileSyntaxSegments,
    buildGitHubPrFileDiffPreview: prDiff.buildGitHubPrFileDiffPreview,
    resolveMobileSyntaxLanguage: syntax.resolveMobileSyntaxLanguage,
    highlightMobileDiffLines: syntax.highlightMobileDiffLines
  }
})
vi.mock('../tasks/mobile-tasks-pressables', () => ({ TasksButton: 'TasksButton' }))

import { ThemeProvider } from '../theme/theme-context'
import { darkSyntaxPalette, lightSyntaxPalette, type SyntaxPalette } from '../theme/syntax-palette'
import { DiffLineRow } from '../session/MobileSessionDiffLineRow'
import { MobileDiffCommentLineRow } from '../session/MobileDiffCommentLineRow'
import { MobileBranchDiffPreviewDrawer } from '../source-control/MobileBranchDiffPreviewDrawer'
import { GitHubPrFileDiff } from '../tasks/MobileTasksPrFileDiff'
import { MobileDiffReviewLine } from './MobileDiffReviewLine'

const SEGMENTS = [
  { text: 'const', kind: 'keyword' as const },
  { text: ' a = ', kind: 'plain' as const },
  { text: "'b'", kind: 'string' as const }
]
const LINE = { kind: 'add' as const, text: "const a = 'b'", newLineNumber: 3, segments: SEGMENTS, highlighted: true }

const sessionRowProps = {
  line: LINE,
  title: 'a.ts',
  index: 0,
  comments: [],
  activeCommentLine: null,
  commentDraft: '',
  commentsBusy: false,
  onStartComment: () => undefined,
  onCancelComment: () => undefined,
  onDraftChange: () => undefined,
  onSubmitComment: () => undefined,
  onDeleteComment: () => undefined
}

const ROWS: [string, () => ReturnType<typeof createElement>][] = [
  ['the session diff tab', () => createElement(DiffLineRow, sessionRowProps)],
  ['the diff-comment row', () => createElement(MobileDiffCommentLineRow, sessionRowProps)],
  [
    'the Changes review screen',
    () =>
      createElement(MobileDiffReviewLine, {
        line: LINE,
        comments: [],
        staleCommentIds: new Set(),
        active: false,
        onAddNote: () => undefined,
        onEditNote: () => undefined
      })
  ],
  [
    "source control's committed-diff drawer",
    () =>
      createElement(MobileBranchDiffPreviewDrawer, {
        branchDiffPreview: {
          kind: 'ready',
          entry: { path: 'a.ts' },
          summary: { baseRef: 'main' },
          truncated: false,
          lines: [LINE]
        } as never,
        onClose: () => undefined
      })
  ],
  [
    "a pull request's file diff in Tasks",
    () =>
      createElement(GitHubPrFileDiff, {
        filePath: 'src/a.ts',
        contents: { original: '', modified: "const a = 'b'\n" } as never,
        commentDrafts: {},
        disabled: false,
        onCommentDraftChange: () => undefined,
        onSubmitComment: () => undefined
      })
  ]
]

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function colourOf(root: ReactTestInstance, text: string): unknown {
  const span = root.findAll((node) => String(node.type) === 'Text' && node.props.children === text)[0]
  expect(span, `a span reading ${JSON.stringify(text)}`).toBeDefined()
  const style = span!.props.style as { color?: unknown } | undefined
  return style?.color
}

describe.each([
  ['light', lightSyntaxPalette],
  ['dark', darkSyntaxPalette]
] as [string, SyntaxPalette][])('syntax colours on a diff row in a %s session', (scheme, palette) => {
  it.each(ROWS)('colour the code on %s from the theme', (_name, element) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme as 'light' | 'dark'}>{element()}</ThemeProvider>
      )
    })
    expect(colourOf(renderer!.root, 'const')).toBe(palette.keyword)
    expect(colourOf(renderer!.root, "'b'")).toBe(palette.string)
  })
})
