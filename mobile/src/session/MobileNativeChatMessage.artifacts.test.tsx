import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { PUBLISH_CALL, PUBLISH_RESULT, PUBLISHED_LINK } from './fixtures/claude-artifact-tool-2.1.301'

vi.mock('../components/DraggableDetailSheet', async () => {
  const React = await import('react')
  return {
    DraggableDetailSheet: ({ visible, children }: { visible: boolean; children?: ReactNode }) =>
      visible ? React.createElement('DraggableDetailSheet', null, children) : null
  }
})
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): unknown => React.createElement('Text', props, children)
  return {
    ActivityIndicator: 'ActivityIndicator',
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
    Image: 'Image',
    PixelRatio: { getFontScale: () => 1 },
    Platform: { OS: 'android', Version: 34 },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) => React.createElement('ScrollView', props, children),
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn(async () => true) }))
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
// The document stands in as an element that says which artifact links reach it.
vi.mock('../components/MobileMarkdown', async () => {
  const React = await import('react')
  const { MarkdownArtifactLinksContext } = await import('../components/markdown-artifact-links')
  return {
    MobileMarkdown: (props: { content?: string }) => {
      const links = React.useContext(MarkdownArtifactLinksContext)
      return React.createElement('MobileMarkdown', { content: props.content, artifactLabel: links?.resolve(PUBLISHED_LINK)?.label ?? null })
    }
  }
})
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))
vi.mock('./open-claude-artifact', () => ({ openClaudeArtifact: vi.fn() }))
vi.mock('./claude-artifact-list-store', () => ({
  useClaudeArtifactList: () => ({ items: [], loading: false, error: null, loadedAt: null })
}))

import { MobileNativeChatMessage } from './MobileNativeChatMessage'

// Where the Artifact card and the artifact links reach in a chat row: the
// Claude app draws links as chips in Claude's words only, and never folds the
// card into a settled turn's hidden work (a18.java, ht1.java; 1.261013.20).

const words = `Published it: ${PUBLISHED_LINK}`

function message(role: NativeChatMessage['role'], blocks: NativeChatMessage['blocks']): NativeChatMessage {
  return { id: `${role}-1`, role, blocks, timestamp: null, source: 'transcript' }
}

let renderer: ReactTestRenderer | null = null

function render(row: NativeChatMessage, props: Record<string, unknown> = {}): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference="light">
        <MobileNativeChatMessage message={row} {...props} />
      </ThemeProvider>
    )
  })
  return renderer!.root
}

const documents = (root: ReactTestInstance) => root.findAll((node) => String(node.type) === 'MobileMarkdown')

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('artifacts in a chat row', () => {
  it("gives Claude's words their artifact links", () => {
    const [document] = documents(render(message('assistant', [{ type: 'text', text: words }])))
    expect(document!.props.artifactLabel).toBe('Artifact · 8JHvPGXw')
  })

  it("leaves the user's own prompt's links as they were", () => {
    const [document] = documents(render(message('user', [{ type: 'text', text: words }]), { promptsAsMarkdown: true }))
    expect(document).toBeDefined()
    expect(document!.props.artifactLabel).toBeNull()
  })

  it("keeps the published page's card in a settled turn whose work is folded away", () => {
    const turn = message('assistant', [{ type: 'text', text: 'Done.' }, PUBLISH_CALL, PUBLISH_RESULT])
    const root = render(turn, { structuredActivityUi: true, activeTurnIsWorking: false })
    expect(root.findAll((node) => node.props?.testID === 'artifact-card' && typeof node.type === 'string')).toHaveLength(1)
  })

  // Review 2026-10-16: a transcript's calls carry no lifecycle state, so a publish the turn never
  // answered (Esc, a crash) read as still publishing and its spinner stayed on a settled turn.
  it('does not leave a publish the turn never answered spinning once the turn has ended', () => {
    const turn = message('assistant', [{ type: 'text', text: 'Publishing.' }, PUBLISH_CALL, { type: 'text', text: 'Interrupted.' }])
    const root = render(turn, { structuredActivityUi: true, activeTurnIsWorking: false })
    expect(root.findAll((node) => node.props?.testID === 'artifact-card-spinner' && typeof node.type === 'string')).toHaveLength(0)
    expect(root.findAll((node) => node.props?.testID === 'artifact-card' && typeof node.type === 'string')).toHaveLength(0)
  })

  it('spins while the turn is still publishing the page', () => {
    const turn = message('assistant', [{ type: 'text', text: 'Publishing.' }, PUBLISH_CALL])
    const root = render(turn, { structuredActivityUi: true, activeTurnIsWorking: true, mayStillGrow: true })
    expect(root.findAll((node) => node.props?.testID === 'artifact-card-spinner' && typeof node.type === 'string')).toHaveLength(1)
  })
})
