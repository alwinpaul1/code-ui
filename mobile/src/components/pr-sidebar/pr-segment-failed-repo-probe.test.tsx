// The Pull Request segment after the GitHub repo probe FAILED, as opposed to answering.
//
// `github.repoSlug` settles every throw into `{ ok: false }` (settleGithubPrRead), and the
// controller used to read that the same way as a real "this repo has no GitHub remote": the
// segment then said "Hosted review panel unavailable for this provider." for good, the header PR
// chip went away, and nothing asked again on a healthy connection. One relay timeout on a GitHub
// repo was enough (reproduced on main 0b2c7a92). A failed probe is its own state: the segment says
// the repository could not be checked and offers Retry, and a real "not GitHub" keeps its copy.

import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../../theme/theme-context'
import { darkColors, lightColors } from '../../theme/tokens'
import type { RpcClient } from '../../transport/rpc-client'
import type { ConnectionState } from '../../transport/types'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ RotateCw: 'RotateCw' }))
// The PR body proper is not under test: a stub that prints the state it was handed.
vi.mock('../MobilePRSidebar', () => ({
  MobilePRSidebar: ({ state }: { state: { kind: string; message?: string } }) =>
    createElement('Text', null, `sidebar:${state.kind}:${state.message ?? ''}`)
}))

const fetchGithubRepoSlug = vi.fn()
vi.mock('../../session/github-pr-rpc', () => ({
  fetchGithubRepoSlug: (...args: unknown[]) => fetchGithubRepoSlug(...args),
  fetchHostedReviewForBranch: vi.fn(),
  fetchPRChecks: vi.fn(),
  fetchPRForBranch: vi.fn(),
  fetchWorkItemDetails: vi.fn()
}))
vi.mock('../../source-control/mobile-pr-link', () => ({
  fetchWorktreeLinkedPR: vi.fn(async () => null)
}))

const { useMobilePrSidebarController } =
  await import('../../session/use-mobile-pr-sidebar-controller')
const { MobilePrViewPanelBody } = await import('./MobilePrViewPanel')

const client = { sendRequest: vi.fn() } as unknown as RpcClient

// The hub's own wiring (MobileSourceControlPanel): the controller feeds the body, with no branch
// so no PR load runs and only the probe decides what the segment says.
function Segment({ connState }: { connState: ConnectionState }): ReactElement {
  const controller = useMobilePrSidebarController({
    client,
    connState,
    worktreeId: 'wt-1',
    branch: null,
    headSha: null
  })
  return createElement(MobilePrViewPanelBody, {
    client,
    connState,
    worktreeId: 'wt-1',
    branch: null,
    headSha: null,
    gitStatus: null,
    isGithubRepo: controller.prSidebarIsGithubRepo,
    branchContextLoaded: controller.prSidebarRepoProbeLoaded,
    controller
  })
}

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const raw = node.props.style
  const flat = (Array.isArray(raw) ? raw.flat() : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

describe('the Pull Request segment after a failed repo probe', () => {
  let renderer: ReactTestRenderer | null = null
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchGithubRepoSlug.mockReset()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    warn.mockRestore()
  })

  function element(connState: ConnectionState, scheme: 'light' | 'dark' = 'light') {
    return (
      <ThemeProvider initialPreference={scheme}>
        {createElement(Segment, { connState })}
      </ThemeProvider>
    )
  }

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  async function mount(connState: ConnectionState, scheme: 'light' | 'dark' = 'light') {
    await act(async () => {
      renderer = create(element(connState, scheme))
    })
    await flush()
  }

  async function rerender(connState: ConnectionState) {
    await act(async () => {
      renderer?.update(element(connState))
    })
    await flush()
  }

  function texts(): string[] {
    return (renderer?.root.findAllByType('Text' as never) ?? []).map((node) =>
      [node.props.children].flat().join('')
    )
  }

  function retryButton() {
    return renderer?.root
      .findAllByType('Pressable' as never)
      .find((node) => node.props.accessibilityLabel === 'Retry checking the repository')
  }

  it('says the repository could not be checked, not that the provider is unsupported, when the probe times out', async () => {
    fetchGithubRepoSlug.mockResolvedValue({ ok: false, error: 'Request timed out' })
    await mount('connected')

    expect(texts().join('\n')).not.toContain('unavailable for this provider')
    expect(texts()).toContain('Could not check the repository.')
    expect(retryButton()).toBeDefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('Request timed out')
  })

  it('checks again on Retry and then shows the pull request body', async () => {
    fetchGithubRepoSlug
      .mockResolvedValueOnce({ ok: false, error: 'Request timed out' })
      .mockResolvedValueOnce({ ok: true, result: { owner: 'o', repo: 'r' } })
    await mount('connected')

    await act(async () => {
      retryButton()?.props.onPress()
    })
    await flush()

    expect(fetchGithubRepoSlug).toHaveBeenCalledTimes(2)
    expect(texts()).not.toContain('Could not check the repository.')
    // No branch here, so the body's own "branch unavailable" state is what a GitHub repo shows.
    expect(texts()).toContain('sidebar:error:Current branch unavailable.')
  })

  it('keeps the unsupported-provider copy when the host answers that the repo has no GitHub remote', async () => {
    fetchGithubRepoSlug.mockResolvedValue({ ok: true, result: null })
    await mount('connected')

    expect(texts()).toContain('sidebar:blocked:Hosted review panel unavailable for this provider.')
    expect(retryButton()).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it('probes again once per new connection and not while the host is down', async () => {
    fetchGithubRepoSlug.mockResolvedValue({ ok: false, error: 'connection closed' })
    await mount('connected')
    expect(fetchGithubRepoSlug).toHaveBeenCalledTimes(1)

    await rerender('reconnecting')
    await rerender('reconnecting')
    expect(fetchGithubRepoSlug).toHaveBeenCalledTimes(1)

    fetchGithubRepoSlug.mockResolvedValue({ ok: true, result: { owner: 'o', repo: 'r' } })
    await rerender('connected')
    await rerender('connected')
    expect(fetchGithubRepoSlug).toHaveBeenCalledTimes(2)
    expect(texts()).not.toContain('Could not check the repository.')
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints the failed-probe state from the %s theme', async (scheme, palette) => {
    fetchGithubRepoSlug.mockResolvedValue({ ok: false, error: 'Request timed out' })
    await mount('connected', scheme)

    const message = renderer!.root
      .findAllByType('Text' as never)
      .find((node) => node.props.children === 'Could not check the repository.')
    expect(message).toBeDefined()
    expect(styleOf(message!).color).toBe(palette.textSecondary)
    expect(styleOf(retryButton()!).backgroundColor).toBe(palette.bgRaised)
    const retryText = renderer!.root
      .findAllByType('Text' as never)
      .find((node) => node.props.children === 'Retry')
    expect(styleOf(retryText!).color).toBe(palette.text)
    expect(renderer!.root.findByType('RotateCw' as never).props.color).toBe(palette.text)
  })
})
