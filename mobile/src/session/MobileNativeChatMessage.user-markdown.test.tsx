import { createElement, type ComponentProps, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// 2026-10-14, the user, beside the Claude app (1.261009.20): a message they
// pasted, written in Markdown (bold steps, fenced commands, `code`, bullets),
// is drawn FORMATTED in the Claude app's bubble. Code UI drew the characters:
// literal `**6. Check memory pressure**` and the ``` fences as text. The
// decompiled app sends a sent prompt's text through the same Markdown
// composable (yy20.e) as a reply, with the same code-block card; only a slash
// command (`rro`) is drawn as a chip of its own. Real text: the prompt in the
// user's recording, with the lines the card cuts off written out.
const mocks = vi.hoisted(() => ({
  /** What each MobileMarkdown mounted for, as it was handed it. */
  documents: [] as string[],
  clipboard: [] as string[]
}))

vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): ReactNode =>
    React.createElement('Text', props, children)
  return {
    AccessibilityInfo: {
      addEventListener: () => ({ remove: () => {} }),
      isReduceMotionEnabled: () => Promise.resolve(false)
    },
    Animated: {
      View: 'View',
      Text,
      Value: class {
        setValue(): void {}
      },
      loop: (animation: unknown) => animation,
      sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
      timing: () => ({ start: vi.fn(), stop: vi.fn() })
    },
    Image: Object.assign(() => null, { getSize: () => undefined }),
    Linking: { openURL: () => Promise.resolve() },
    PixelRatio: { get: () => 3, getFontScale: () => 1 },
    Platform: { OS: 'android', Version: 34, select: (o: Record<string, unknown>) => o.android ?? o.default },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  return {
    default: { View: 'AnimatedView', createAnimatedComponent: (component: unknown) => component },
    Easing: { out: (fn: unknown) => fn, quad: (t: number) => t },
    useSharedValue: (initial: number) => React.useRef({ value: initial }).current,
    useAnimatedStyle: <T extends object>(factory: () => T) => factory(),
    cancelAnimation: () => {},
    withTiming: (to: number) => to
  }
})
vi.mock('expo-clipboard', () => ({
  setStringAsync: vi.fn(async (value: string) => {
    mocks.clipboard.push(value)
    return true
  })
}))
vi.mock('../platform/haptics', () => ({
  triggerSuccess: vi.fn(),
  triggerError: vi.fn(),
  triggerSelection: vi.fn(),
  triggerMediumImpact: vi.fn()
}))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
vi.mock('../components/pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
// A hold on a sent prompt opens its menu in a drawer; this one is a bare shell.
vi.mock('../components/BottomDrawer', async () => {
  const { BottomDrawerDouble } = await import('./user-message-menu.test-support')
  return { BottomDrawer: BottomDrawerDouble }
})
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
// The real document, with a record of the source it was handed.
vi.mock('../components/MobileMarkdown', async (importOriginal) => {
  const React = await import('react')
  const actual = await importOriginal<typeof import('../components/MobileMarkdown')>()
  return {
    MobileMarkdown: (props: ComponentProps<typeof actual.MobileMarkdown>) => {
      mocks.documents.push(props.content ?? '')
      return React.createElement(actual.MobileMarkdown, props)
    }
  }
})

import { codeBlockCards } from '../components/mobile-markdown-code-block.test-support'
import { contrastRatio } from '../test/contrast'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, fontFamily, lightColors } from '../theme/tokens'
import { normalizeReconcileText, normalizedUserText } from './mobile-native-chat-draft-reconcile'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { holdThenChoose } from './user-message-menu.test-support'

const PASTED = [
  'The diagnosis holds up: the problem was 56 `node` processes using 34 GB, not Orca itself. These steps make the fix enforced rather than something each agent has to remember.',
  '',
  '**1. Put the rule in the repo, not just in agent memory.** Agents in other worktrees may not see that session\'s memory. Add this to `CLAUDE.md` (or `AGENTS.md` for Codex):',
  '',
  '```',
  '- Only run tests for files you changed.',
  '- Never run the full test suite or the type check from a second agent.',
  '```',
  '',
  '**2. Cap vitest workers in config**, so a bare `vitest` can\'t spawn a worker per CPU core:',
  '',
  '```ts',
  '// vitest.config.ts',
  'test: { maxWorkers: 2 }',
  '```',
  '',
  'On older vitest versions, use `--maxWorkers=2` on the command line instead.',
  '',
  '**3. Cap the type check\'s heap:**',
  '',
  '```bash',
  'NODE_OPTIONS=--max-old-space-size=4096 pnpm typecheck',
  '```',
  '',
  '`--incremental` also makes repeat runs much cheaper.',
  '',
  '**4. Use a lock so only one full run can happen at a time**, whichever agent starts it:',
  '',
  '```bash',
  'until mkdir /tmp/fullcheck.lock 2>/dev/null; do sleep 5; done',
  'trap \'rmdir /tmp/fullcheck.lock\' EXIT',
  'pnpm typecheck && pnpm test',
  '```',
  '',
  '**5. Limit Gradle for the APK builds.** Gradle daemons stay in memory after a build finishes.',
  '',
  '- In `gradle.properties`, set `org.gradle.jvmargs=-Xmx2g`.',
  '- Run `./gradlew --stop` after each build.',
  '',
  '**6. Check memory pressure quickly** with `memory_pressure | tail -1` in the terminal. If free memory drops below about 20%, pause agents.',
  '',
  'With 4 agents running targeted tests plus 1 APK build, you\'re near the limit for 16 GB. Steps 2 and 5 matter most right now.',
  '',
  'So do this for both of my profiles, named .claude and .claude-work.'
].join('\n')

function userMessage(text: string): NativeChatMessage {
  return { id: 'u1', role: 'user', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

/** The words a node draws, its nested spans included. */
function words(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(words).join('')
}

type Style = Record<string, unknown>
function flat(style: unknown): Style {
  return Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : ((style as Style | null | undefined) ?? {})
}

describe('a sent prompt written in Markdown', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    mocks.documents.length = 0
    mocks.clipboard.length = 0
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(message: NativeChatMessage, scheme: 'light' | 'dark' = 'light', props = {}): ReactTestInstance {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme } as ComponentProps<typeof ThemeProvider>,
          createElement(MobileNativeChatMessage, { message, ...props })
        )
      )
    })
    return renderer!.root
  }

  const texts = (root: ReactTestInstance): ReactTestInstance[] =>
    root.findAll((node) => String(node.type) === 'Text')
  /** Everything the tree draws as words. */
  const drawn = (root: ReactTestInstance): string => texts(root).map(words).join('\n')
  const bubbleOf = (root: ReactTestInstance, scheme: 'light' | 'dark'): ReactTestInstance | undefined =>
    root.findAll(
      (node) =>
        String(node.type) === 'Pressable' &&
        flat(node.props.style).backgroundColor === (scheme === 'dark' ? darkColors : lightColors).userBubble
    )[0]

  it.each(['light', 'dark'] as const)(
    'draws a pasted markdown message formatted, not as raw asterisks and fences, in %s',
    (scheme) => {
      const root = render(userMessage(PASTED), scheme)
      const all = drawn(root)
      expect(all).not.toContain('**')
      expect(all).not.toContain('```')
      // The four fences are the Claude app's code card: the language, or "Code".
      const cards = codeBlockCards(root)
      expect(cards.map((card) => /^(Code|Ts|Bash)/.exec(words(card))?.[0])).toEqual(['Code', 'Ts', 'Bash', 'Bash'])
      expect(words(cards[1]!)).toContain('maxWorkers: 2')
      expect(words(cards[3]!)).toContain('pnpm typecheck && pnpm test')
      // A step's lead-in is bold, in the semibold face, in the bubble's ink.
      const lead = texts(root).find((node) => words(node) === '1. Put the rule in the repo, not just in agent memory.')
      expect(lead).toBeDefined()
      expect(flat(lead!.props.style).fontFamily).toBe(fontFamily.semibold)
      // Bullets are bullets, and the inline code is a pill, not backticks.
      expect(all).toContain('•')
      expect(texts(root).some((node) => words(node) === 'node')).toBe(true)
      expect(texts(root).some((node) => words(node) === 'gradle.properties')).toBe(true)
    }
  )

  it.each(['light', 'dark'] as const)('keeps the bubble and its words on the theme tokens in %s', (scheme) => {
    const colors = scheme === 'dark' ? darkColors : lightColors
    const root = render(userMessage(PASTED), scheme)
    expect(bubbleOf(root, scheme)).toBeDefined()
    // The document sets its words in `colors.text`; the bubble's ink is
    // `colors.userBubbleText`. They have to be one colour, or a formatted
    // prompt reads in another ink than the plain one beside it.
    expect(colors.userBubbleText).toBe(colors.text)
    const lead = texts(root).find((node) => words(node).startsWith('1. Put the rule'))!
    expect(flat(lead.props.style).color).toBe(colors.userBubbleText)
    const card = codeBlockCards(root)[0]!
    const header = card.findAll((node) => flat(node.props.style).backgroundColor === colors.codeBlockHeader)
    expect(header.length).toBeGreaterThan(0)
    // What the document adds in colour has to read on the bubble.
    expect(contrastRatio(colors.userBubbleText, colors.userBubble)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(colors.codeSpanText, colors.userBubble)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(colors.accentText, colors.userBubble)).toBeGreaterThanOrEqual(4.5)
  })

  it('copies the raw Markdown from the menu a hold opens, and nothing in the bubble takes the hold for a selection', async () => {
    const root = render(userMessage(PASTED))
    const bubble = bubbleOf(root, 'light')!
    await holdThenChoose(root, 'Copy message')
    expect(mocks.clipboard).toEqual([PASTED])
    expect(texts(bubble).filter((node) => node.props.selectable === true)).toEqual([])
  })

  it('does not select in the bubble even where the chat lets a reply select', () => {
    const root = render(userMessage('**bold** and `code`'))
    expect(texts(bubbleOf(root, 'light')!).filter((node) => node.props.selectable === true)).toEqual([])
  })

  it('hands the renderer the text exactly as it was sent, so the echo that matches it by its text still does', () => {
    const message = userMessage(PASTED)
    render(message)
    expect(mocks.documents).toEqual([PASTED])
    expect(message.blocks).toEqual([{ type: 'text', text: PASTED }])
    expect(normalizedUserText(message)).toBe(normalizeReconcileText(PASTED))
  })

  it('draws the queued echo of a Markdown prompt as it will draw once it lands', () => {
    const root = render(userMessage('**Run** `pnpm test`'), 'light', { onCancelQueued: () => undefined })
    expect(drawn(root)).not.toContain('**')
    expect(drawn(root)).toContain('Queued')
  })

  it('keeps the uploads above the bubble and formats the words under them', () => {
    const root = render(
      userMessage('@"/Users/me/.claude-work/uploads/abcdef01-spec.pdf" Please **read** the spec, then `pnpm test`.')
    )
    expect(root.findAllByProps({ accessibilityLabel: 'Attached file spec' }).length).toBeGreaterThan(0)
    const all = drawn(root)
    expect(all).not.toContain('@"')
    expect(all).not.toContain('**')
    expect(mocks.documents).toEqual(['Please **read** the spec, then `pnpm test`.'])
    const bubble = bubbleOf(root, 'light')!
    expect(bubble.findAllByProps({ accessibilityLabel: 'Attached file spec' })).toEqual([])
  })

  it('keeps a line break the user typed, where a plain Markdown paragraph would fold it into a space', () => {
    const root = render(userMessage('Fix **this**\nthen run `pnpm test`'))
    const prose = texts(root).find((node) => words(node).includes('then run'))!
    expect(words(prose)).toContain('\n')
  })

  // Review of b6faacb4a (an Opus reviewer, probes 1-4): the document is built
  // for a reply, and it read a prompt as one: it took tag names out of
  // `<Text> inside <View>`, decoded `&amp;`, dropped the indent of a
  // continuation line, and read `__init__`, `dist/*.js` and `logs\*.log` as
  // marks. A prompt is the user's words; only a mark that is plainly Markdown
  // may change how they draw, and nothing else of them may.
  describe('what the user typed stays what they typed', () => {
    it.each([
      ['a tag name', 'why does <Text> inside <View> not wrap? **help**', ['<Text> inside <View> not wrap?']],
      ['a generic type', 'a `x` of Array<Image> and <Button>', ['Array<Image> and <Button>']],
      ['an entity', '**x** &amp; &lt;div&gt;', [' &amp; &lt;div&gt;']],
      ['an HTML comment', '<!-- todo --> **x**', ['<!-- todo --> ']],
      ['the indent of a line', 'Steps `a`:\n  first\n    second', ['\n  first\n    second']],
      ['a path with a backslash', 'copy `x` to C:\\dir\\ now', ['C:\\dir\\ now']]
    ])('draws %s of a Markdown prompt as it was typed', (_name, text, kept) => {
      const root = render(userMessage(text))
      expect(mocks.documents).toEqual([text])
      for (const words of kept) {
        expect(drawn(root)).toContain(words)
      }
    })

    it.each([
      "if __name__ == '__main__': run()",
      'open __init__.py and check',
      'rm dist/*.js lib/*.js',
      'cp -r src/**/*.ts out/',
      'a*b*c and 2*3*4',
      'logs\\*.log are in C:\\logs',
      '\\\\nas\\share has the file',
      'match \\d+\\.\\d+ in it',
      '---',
      '***',
      'above\n\n---\n\nbelow',
      'this is *really* it, and _so_ is this',
      'try https://example.com/spec',
      'it was ~~wrong~~ right'
    ])('does not take %j for Markdown', (text) => {
      const root = render(userMessage(text))
      expect(mocks.documents).toEqual([])
      expect(texts(root).map(words)).toContain(text)
    })

    it('leaves a file name and a path in a Markdown prompt plain, so a hold on them still opens the prompt’s menu', () => {
      const root = render(userMessage('see `run.py` at src/app/index.ts, then **go**'), 'light', {
        onOpenFile: () => undefined
      })
      expect(mocks.documents).toHaveLength(1)
      expect(texts(root).filter((node) => typeof node.props.onPress === 'function')).toEqual([])
    })

    it('still opens a link the user wrote as one', () => {
      const root = render(userMessage('read [the spec](https://example.com/spec) **now**'))
      expect(texts(root).filter((node) => typeof node.props.onPress === 'function').map(words)).toEqual(['the spec'])
    })
  })

  describe('what stays plain', () => {
    it('draws ordinary words as the plain bubble line they always were', () => {
      const root = render(userMessage('ship it, then tell me what broke at 3 * 4 * 5'))
      expect(mocks.documents).toEqual([])
      const line = texts(root).find((node) => words(node).startsWith('ship it'))!
      expect(flat(line.props.style)).toMatchObject({ fontSize: 15, lineHeight: 22, color: lightColors.userBubbleText })
    })

    it('draws one plain line, and an empty one, without a document', () => {
      render(userMessage('ok'))
      expect(mocks.documents).toEqual([])
      act(() => renderer?.unmount())
      render(userMessage(''))
      expect(mocks.documents).toEqual([])
    })

    it.each([
      '/code-review the diff with `pnpm test` and **care**',
      '/loop check job 2888',
      '/plugin:cmd **x**',
      '  /effort `high`'
    ])('draws the slash command %j as the plain line it is', (text) => {
      const root = render(userMessage(text))
      expect(mocks.documents).toEqual([])
      expect(words(texts(root).find((node) => words(node).includes('/'))!)).toBe(text)
    })

    it('does not take a path for a command', () => {
      render(userMessage('/Users/me/app/README.md has **no** install step'))
      expect(mocks.documents).toHaveLength(1)
    })

    it.each(['```', '```ts', '```\n```', '- ', '1.', '#', '> ', '**', '`'])(
      'never draws %j as an empty bubble',
      (text) => {
        const root = render(userMessage(text))
        const bubble = bubbleOf(root, 'light')!
        expect(words(bubble).replace(/\s/g, '')).not.toBe('')
        expect(drawn(root)).toContain(text.trim().split('\n')[0]!.trim())
      }
    )

    it('draws a very long paste of Markdown as the plain line, without parsing it', () => {
      const paste = `**note** ${'word `x` '.repeat(5000)}`
      const started = performance.now()
      const root = render(userMessage(paste))
      expect(mocks.documents).toEqual([])
      expect(drawn(root)).toContain('**note**')
      expect(performance.now() - started).toBeLessThan(2000)
    })

    it('draws a long paste of plain words as the plain line', () => {
      render(userMessage('plain words '.repeat(20000)))
      expect(mocks.documents).toEqual([])
    })
  })
})
