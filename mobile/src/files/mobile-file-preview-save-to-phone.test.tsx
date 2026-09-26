import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(
  (): {
    connection: { client: { sendRequest: (...args: unknown[]) => unknown } | null; state: string }
    device: {
      supported: boolean
      save: (run: { notify: (message: string, durationMs?: number) => void }) => Promise<unknown>
    }
  } => ({
    connection: { client: null, state: 'connected' },
    device: { supported: true, save: async () => ({ status: 'saved' }) }
  })
)

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Image: 'Image',
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 390, height: 844 })
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'Icon', Download: 'Icon', Save: 'Icon' }))
vi.mock('../navigation/route-handoff', () => ({
  useRouteHandoff: () => ({ back: () => {}, canGoBack: () => false })
}))
vi.mock('../components/ConfirmModal', () => ({ ConfirmModal: () => null }))
vi.mock('./MobileFileMarkdownPreview', () => ({ MobileFileMarkdownPreview: () => null }))
vi.mock('./MobileFilePreviewSourceText', () => ({ MobileFilePreviewSourceText: () => null }))
vi.mock('./MobileFilePdfPreview', () => ({ MobileFilePdfPreview: () => null }))
vi.mock('./mobile-pdf-cache', () => ({
  resolveMobilePdfUri: async () => ({
    uri: 'file:///cache/orca-pdf-1.pdf',
    byteLength: 9,
    fromCache: false
  })
}))
// The device half opens Android's picker through expo-intent-launcher, which has no Node entry;
// what the header hands it is what is under test.
vi.mock('./mobile-file-save-device', () => ({
  get isSaveToPhoneSupported() {
    return harness.device.supported
  },
  saveDesktopFileToPhoneOnDevice: (run: { notify: (message: string) => void }) =>
    harness.device.save(run)
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))
vi.mock('../transport/client-context', () => ({
  useForceReconnect: () => null,
  useHostClient: () => ({ ...harness.connection, clientId: null })
}))

import { ThemeProvider } from '../theme/theme-context'
import { colorsForScheme } from '../theme/tokens'
import { MobileFilePreviewScreen } from './MobileFilePreviewScreen'

let tree: ReactTestRenderer | null = null

afterEach(() => {
  act(() => tree?.unmount())
  tree = null
  harness.connection = { client: null, state: 'connected' }
  harness.device = { supported: true, save: async () => ({ status: 'saved' }) }
})

const ROUTE = {
  ok: true,
  params: { hostId: 'host-a', worktreeId: 'wt-1', relativePath: 'docs/README.md' }
} as const
const PDF_ROUTE = {
  ok: true,
  params: { hostId: 'host-a', worktreeId: 'wt-1', relativePath: 'papers/thesis.pdf' }
} as const

function connected() {
  // A load that never settles keeps the screen on its spinner; the header is what is looked at.
  harness.connection = {
    client: { sendRequest: vi.fn(() => new Promise(() => {})) },
    state: 'connected'
  }
  return harness.connection.client
}

async function render(
  scheme: 'light' | 'dark',
  route: typeof ROUTE | typeof PDF_ROUTE = ROUTE
): Promise<ReactTestRenderer> {
  await act(async () => {
    tree = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileFilePreviewScreen route={route} />
      </ThemeProvider>
    )
  })
  if (tree === null) {
    throw new Error('the preview did not render')
  }
  return tree
}

function saveButton(rendered: ReactTestRenderer): ReactTestInstance | undefined {
  return rendered.root.findAll(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Save to phone'
  )[0]
}

function header(rendered: ReactTestRenderer): ReactTestInstance {
  return rendered.root.findAll((node) => String(node.type) === 'SafeAreaView')[0]!
}

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const style = node.props.style as unknown
  return Object.assign({}, ...(Array.isArray(style) ? style.filter(Boolean) : [style]))
}

describe('Save to phone in the file preview header', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`is there in ${scheme} mode, on a header painted from that theme`, async () => {
      connected()
      const rendered = await render(scheme)
      const palette = colorsForScheme(scheme)

      const button = saveButton(rendered)
      expect(button).toBeDefined()
      expect(button!.props.accessibilityRole).toBe('button')
      expect(styleOf(header(rendered)).backgroundColor).toBe(palette.bgPanel)
      expect(styleOf(button!).backgroundColor).toBe(palette.bgRaised)
    })
  }

  it('paints the two themes differently, so neither is a fixed palette', async () => {
    connected()
    const light = styleOf(header(await render('light'))).backgroundColor
    act(() => tree?.unmount())
    const dark = styleOf(header(await render('dark'))).backgroundColor
    expect(light).not.toBe(dark)
  })

  it('saves this file from its worktree', async () => {
    const client = connected()
    const save = vi.fn(async () => ({ status: 'saved' }))
    harness.device.save = save
    const rendered = await render('light')

    await act(async () => {
      saveButton(rendered)!.props.onPress()
    })

    expect(save).toHaveBeenCalledWith({
      client,
      source: { source: 'worktree', worktreeId: 'wt-1', relativePath: 'docs/README.md' },
      notify: expect.any(Function),
      // Aborted when the preview closes (mobile-file-preview-save-after-leaving.test.tsx).
      signal: expect.any(AbortSignal)
    })
  })

  it("shows the save's own words as a toast", async () => {
    connected()
    harness.device.save = async ({ notify }) => {
      notify("Can't save README.md: it is over 80.0 MB, the most the phone takes from the desktop")
      return { status: 'refused' }
    }
    const rendered = await render('dark')

    await act(async () => {
      saveButton(rendered)!.props.onPress()
    })

    expect(
      rendered.root.findAll(
        (node) =>
          node.props.children ===
          "Can't save README.md: it is over 80.0 MB, the most the phone takes from the desktop"
      )
    ).not.toHaveLength(0)
  })

  it('cannot be pressed while the desktop is not connected', async () => {
    harness.connection = { client: null, state: 'reconnecting' }
    const rendered = await render('light')

    expect(saveButton(rendered)!.props.disabled).toBe(true)
  })

  it("leaves a PDF on screen to the viewer's own Download instead of a second button", async () => {
    connected()
    const rendered = await render('light', PDF_ROUTE)

    expect(saveButton(rendered)).toBeUndefined()
  })

  it('is left out where the phone has no save picker', async () => {
    connected()
    harness.device.supported = false
    const rendered = await render('light')

    expect(saveButton(rendered)).toBeUndefined()
  })
})
