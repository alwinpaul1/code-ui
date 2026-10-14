import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-secure-store', () => ({ setItemAsync: vi.fn(), getItemAsync: vi.fn(async () => null), deleteItemAsync: vi.fn() }))
vi.mock('expo-crypto', () => ({ getRandomBytes: vi.fn(), digestStringAsync: vi.fn() }))
vi.mock('expo-linking', () => ({ openURL: vi.fn() }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): unknown => React.createElement('Text', props, children)
  return {
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    Pressable: 'Pressable',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light'
  }
})
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return { BottomDrawer: ({ visible, children }: { visible: boolean; children?: ReactNode }) => (visible ? React.createElement('Drawer', null, children) : null) }
})
vi.mock('../ui/Button', async () => {
  const React = await import('react')
  return { Button: ({ label, onPress }: { label: string; onPress: () => void }) => React.createElement('Button', { label, onPress }) }
})

import { MobileCcrImagesSelfTest } from './MobileCcrImagesSelfTest'
import { formatCcrSelfTest, runCcrSelfTest } from './ccr-session-self-test'
import { resetCcrPipelineForTests, setCcrSelfTestContext, type CcrPipelineDeps } from './ccr-session-pipeline'
import { resetCcrModelForTests } from './ccr-session-model'
import { ThemeProvider } from '../theme/theme-context'
import { colorsForScheme } from '../theme/tokens'
import {
  ACCOUNT_UUID,
  ORG_UUID,
  PNG_1PX,
  SESSION_A,
  TOKEN,
  apiRoutes,
  assistantEvent,
  eventsReply,
  fakeFetch,
  imageBlock,
  readResultEvent,
  reply,
  sessionRow,
  sessionsReply,
  type Route
} from './fixtures/ccr-session-api-2026-10-14'

const routes = (): Route[] =>
  apiRoutes({
    sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A, { external_metadata: { model: 'claude-opus-5-5', effort_level: 'high' } })])),
    events: { [SESSION_A]: () => reply(200, eventsReply([assistantEvent('m1', 'toolu_A', '/tmp/codeui.png'), readResultEvent('m2', 'toolu_A', [imageBlock(PNG_1PX)])])) }
  })

function deps(token: string | null = TOKEN, list: Route[] = routes()): CcrPipelineDeps {
  return {
    fetch: fakeFetch(list).fetch,
    readToken: async () => token,
    org: { read: async () => ({ accountUuid: ACCOUNT_UUID, organizationUuid: ORG_UUID }), write: async () => undefined, clear: async () => undefined },
    keep: (_key, uri) => uri,
    maxBytes: 8 * 1024 * 1024,
    log: () => undefined
  }
}

const context = () => setCcrSelfTestContext({ tabId: 'tab-1', epoch: 1, messageIds: ['m1', 'm2'], wanted: { toolUseIds: ['toolu_A'], userMessageIds: [] } })

beforeEach(() => {
  resetCcrPipelineForTests()
  resetCcrModelForTests()
})

describe('the one-tap check', () => {
  it('reports every stage of a working path, model and effort included', async () => {
    context()
    const lines = await runCcrSelfTest(deps())
    expect(formatCcrSelfTest(lines)).toBe(
      [
        '✓ Chat: tab tab… (5), 2 messages, 1 Read pictures and 0 pasted messages to look for',
        '✓ Anthropic sign-in: signed in',
        '✓ Organization: organization 8f3…002 (36) (cached)',
        '✓ Remote Control sessions: 1 Remote Control session to compare (1 listed)',
        '✓ This tab’s session: session cse…aaa (28) shares 2 messages with this tab',
        '✓ Model and effort: model claude-opus-5-5, effort high',
        '✓ Pictures: 1 of 1 picture found in 1 page of events'
      ].join('\n')
    )
  })

  it('matches afresh each time it is run', async () => {
    context()
    await runCcrSelfTest(deps())
    const again = await runCcrSelfTest(deps())
    expect(again.map((line) => line.label)).toContain('Remote Control sessions')
    expect(again.find((line) => line.label === 'Remote Control sessions')!.detail).not.toContain('skipped')
  })

  it('stops at the first failing stage and says why', async () => {
    context()
    const lines = await runCcrSelfTest(deps(null))
    expect(formatCcrSelfTest(lines).split('\n').slice(1)).toEqual(['✗ Anthropic sign-in: not signed in to Anthropic on this phone (Voice settings → Sign in)'])
  })

  it('asks for a Claude chat when none is open', async () => {
    await expect(runCcrSelfTest(deps())).resolves.toEqual([
      { ok: false, label: 'Chat', detail: 'open a Claude chat first; the check runs against the chat on screen' }
    ])
  })
})

describe('the check’s sheet', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const open = async (scheme: 'light' | 'dark', withDeps: CcrPipelineDeps): Promise<ReactTestInstance> => {
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileCcrImagesSelfTest visible onClose={() => undefined} deps={withDeps} />
        </ThemeProvider>
      )
    })
    for (let round = 0; round < 8; round += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
    return renderer!.root
  }
  const marks = (root: ReactTestInstance) =>
    root
      .findAll((node) => (node.type as unknown) === 'Text' && (node.props.children === '✓' || node.props.children === '✗'))
      .map((node) => ({ mark: node.props.children as string, color: (Object.assign({}, ...[node.props.style].flat(3).filter(Boolean)) as { color?: string }).color }))

  it.each(['light', 'dark'] as const)('marks passed stages in the theme’s success colour (%s)', async (scheme) => {
    context()
    const root = await open(scheme, deps())
    const drawn = marks(root)
    expect(drawn.length).toBe(7)
    expect(drawn.every((entry) => entry.mark === '✓' && entry.color === colorsForScheme(scheme).success)).toBe(true)
  })

  it.each(['light', 'dark'] as const)('marks a failed stage in the theme’s danger colour (%s)', async (scheme) => {
    context()
    const root = await open(scheme, deps(null))
    expect(marks(root).at(-1)).toEqual({ mark: '✗', color: colorsForScheme(scheme).danger })
  })
})
