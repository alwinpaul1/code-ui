import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => {
  function flatten(style: unknown): Record<string, unknown> | undefined {
    if (style == null || style === false) {
      return undefined
    }
    if (Array.isArray(style)) {
      return Object.assign({}, ...style.map((item) => flatten(item) ?? {}))
    }
    return typeof style === 'object' ? { ...(style as Record<string, unknown>) } : undefined
  }
  return {
    Pressable: 'Pressable',
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
    Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
    StyleSheet: { create: (s: unknown) => s, flatten, hairlineWidth: 1 }
  }
})
vi.mock('lucide-react-native', () => ({ MessageSquare: 'Icon', Plus: 'Icon', X: 'Icon' }))
// The tasks barrel re-exports half the app; the PR diff needs only these.
vi.mock('../tasks/mobile-tasks-dependencies', async () => {
  const react = await vi.importActual<typeof import('react')>('react')
  const theme = await vi.importActual<typeof import('../theme/mobile-theme')>('../theme/mobile-theme')
  const syntax = await vi.importActual<typeof import('./mobile-file-syntax')>('./mobile-file-syntax')
  const segments = await vi.importActual<typeof import('../components/MobileSyntaxSegments')>(
    '../components/MobileSyntaxSegments'
  )
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

import { instrumentSansTextStyle } from '../theme/instrument-sans-text'
import { fontFamily } from '../theme/tokens'
import { DiffLineRow } from './MobileSessionDiffLineRow'
import { GitHubPrFileDiff } from '../tasks/MobileTasksPrFileDiff'

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

/** The face a Text draws in once the React Native patch has run over it. */
function drawnFace(node: ReactTestInstance): unknown {
  const drawn = instrumentSansTextStyle(node.props.style) as unknown
  const items = Array.isArray(drawn) ? drawn.flat(4) : [drawn]
  return Object.assign({}, ...items.filter((item) => item && typeof item === 'object')).fontFamily
}

function textReading(r: ReactTestRenderer, text: string): ReactTestInstance {
  const node = r.root
    .findAllByType('Text' as never)
    .find((candidate) => candidate.children.join('') === text)
  expect(node, `a Text reading ${JSON.stringify(text)}`).toBeDefined()
  return node!
}

// Same shape as the file reader's spans (2026-09-26): a nested Text that names
// no face draws Instrument Sans inside a monospace line. For a diff prefix
// that is worse than a look: "+ ", "- " and "  " are different widths in a
// proportional face, so the code after them no longer lines up row to row.
describe('the +/- prefix inside a monospace diff line', () => {
  it('draws in the code face in a session diff', () => {
    for (const kind of ['add', 'delete', 'context'] as const) {
      act(() => {
        renderer = create(
          createElement(DiffLineRow, {
            line: {
              kind,
              text: 'const a = 1',
              newLineNumber: 3,
              segments: [{ text: 'const a = 1', kind: 'plain' }],
              highlighted: false
            },
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
          })
        )
      })
      const prefix = kind === 'add' ? '+ ' : kind === 'delete' ? '- ' : '  '
      expect(drawnFace(textReading(renderer!, prefix)), kind).toBe(fontFamily.mono)
      act(() => renderer?.unmount())
      renderer = null
    }
  })

  it('draws in the code face in a pull request’s file diff', () => {
    act(() => {
      renderer = create(
        createElement(GitHubPrFileDiff, {
          filePath: 'src/a.ts',
          contents: { original: 'const a = 1\n', modified: 'const a = 2\n' },
          commentDrafts: {},
          disabled: false,
          onCommentDraftChange: () => undefined,
          onSubmitComment: () => undefined
        } as never)
      )
    })
    const prefixes = renderer!.root
      .findAllByType('Text' as never)
      .filter((node) => /^[+-] ?\s?$/.test(node.children.join('')))
    expect(prefixes.length).toBeGreaterThan(0)
    for (const prefix of prefixes) {
      expect(drawnFace(prefix)).toBe(fontFamily.mono)
    }
  })
})
