import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { MobileFileSaveTarget } from './mobile-file-save'

// The preview's Save to phone with the REAL runner (createSaveToPhoneRunner) behind it and a fake
// picker, so what the user sees after walking away from a long read is what runs.

const phone = vi.hoisted(() => {
  const target = {
    createDocument: vi.fn(async (_name: string, _mime: string) => 'content://downloads/document/7'),
    writeBase64: vi.fn(async (_uri: string, _base64: string) => {}),
    remove: vi.fn(async (_uri: string) => {})
  }
  return { target }
})

const desktop = vi.hoisted(() => {
  let releaseChunk: (() => void) | null = null
  const chunkGate = new Promise<void>((resolve) => {
    releaseChunk = resolve
  })
  const file = Buffer.from('export const answer = 42\n')
  return {
    release: () => releaseChunk?.(),
    connection: {
      client: {
        sendRequest: async (method: string, params: Record<string, unknown>) => {
          if (method !== 'files.readChunk') {
            // The preview's own load never settles; the header is what is pressed.
            return new Promise(() => {})
          }
          await chunkGate
          const offset = params.offset as number
          const slice = file.subarray(offset, offset + (params.length as number))
          return {
            id: '1',
            ok: true,
            result: {
              contentBase64: slice.toString('base64'),
              bytesRead: slice.length,
              eof: offset + slice.length >= file.length
            },
            _meta: { runtimeId: 'runtime-1' }
          }
        }
      },
      state: 'connected',
      clientId: null
    }
  }
})

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
vi.mock('./mobile-pdf-cache', () => ({ resolveMobilePdfUri: vi.fn() }))
vi.mock('./mobile-file-save-device', async () => {
  const real = await vi.importActual<typeof import('./mobile-file-save')>('./mobile-file-save')
  return {
    isSaveToPhoneSupported: true,
    saveDesktopFileToPhoneOnDevice: real.createSaveToPhoneRunner(
      phone.target as MobileFileSaveTarget
    )
  }
})
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))
vi.mock('../transport/client-context', () => ({
  useForceReconnect: () => null,
  useHostClient: () => desktop.connection
}))

import { ThemeProvider } from '../theme/theme-context'
import { MobileFilePreviewScreen } from './MobileFilePreviewScreen'

describe('walking away from a save that is still reading', () => {
  it('does not open the system save picker after the user has left the preview', async () => {
    let tree: ReactTestRenderer | null = null
    await act(async () => {
      tree = create(
        <ThemeProvider initialPreference="light">
          <MobileFilePreviewScreen
            route={{
              ok: true,
              params: { hostId: 'host-a', worktreeId: 'wt-1', relativePath: 'src/answer.ts' }
            }}
          />
        </ThemeProvider>
      )
    })
    const rendered = tree as unknown as ReactTestRenderer
    const save = rendered.root.findAll(
      (node) =>
        String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Save to phone'
    )[0]!

    await act(async () => {
      save.props.onPress()
    })
    // The read is under way; the user gives up waiting and goes back.
    act(() => rendered.unmount())
    await act(async () => {
      desktop.release()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(phone.target.createDocument).not.toHaveBeenCalled()
  })
})
