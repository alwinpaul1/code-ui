import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The PDF viewer's Download shares Android's create-document picker gate with the file save
// (mobile-picker-gate.ts): its own picker call can end up queued behind another one -- a file save,
// or a different Download -- still open elsewhere. If the viewer unmounts while queued, it used to
// still open its own picker once its turn came, over whatever screen the user had moved to, and
// then call setSaveState on the now-unmounted component. Its Download now carries a waiter tied to
// its own mount state (mobile-pdf-download-device.ts, mobile-pdf-download.ts).

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  // android-create-document.ts polls this for the picker gate's stale-result escape
  // (mobile-picker-gate.ts); 'active' throughout keeps that escape out of this test's way.
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  Share: { share: async () => {} },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ Check: 'Icon', Download: 'Icon' }))

/** A picker whose result the test controls directly, standing in for expo-intent-launcher's
 *  native module. */
const picker = vi.hoisted(() => {
  let closeCurrent: ((result: { resultCode: number; data?: string }) => void) | null = null
  return {
    isOpen: () => closeCurrent !== null,
    open: () =>
      new Promise<{ resultCode: number; data?: string }>((resolve) => {
        closeCurrent = resolve
      }),
    close: (data: string) => {
      const resolve = closeCurrent
      closeCurrent = null
      resolve?.({ resultCode: -1, data })
    }
  }
})
vi.mock('expo-intent-launcher', () => ({
  ResultCode: { Success: -1 },
  startActivityAsync: () => picker.open()
}))
vi.mock('expo-file-system', () => ({
  File: class {
    write() {}
    delete() {}
  },
  Paths: {}
}))
vi.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: async () => 'JVBERi0xLjcK'
}))

import { ThemeProvider } from '../theme/theme-context'
import { MobileFilePdfPreview } from './MobileFilePdfPreview'
import { withPickerGate } from './mobile-picker-gate'

let tree: ReactTestRenderer | null = null
afterEach(() => {
  act(() => tree?.unmount())
  tree = null
})

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('the PDF viewer Download unmounted while queued behind another picker', () => {
  it('never opens its own picker later, over another screen, once it has unmounted', async () => {
    // Something else already holds the picker gate -- another Download, say.
    const occupying = withPickerGate(() => picker.open())
    await vi.waitFor(() => expect(picker.isOpen()).toBe(true))

    await act(async () => {
      tree = create(
        <ThemeProvider initialPreference="light">
          <MobileFilePdfPreview uri="file:///cache/orca-pdf-1.pdf" fileName="doc.pdf" />
        </ThemeProvider>
      )
    })
    await act(async () => {
      await flushMicrotasks()
    })
    const download = tree!.root.findAll(
      (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Download PDF'
    )[0]!
    await act(async () => {
      download.props.onPress()
      await flushMicrotasks()
    })

    // The user navigates away before the viewer's own picker call gets its turn.
    act(() => {
      tree!.unmount()
    })
    tree = null

    // The occupying picker closes; the viewer's own request's turn comes.
    picker.close('content://downloads/document/1')
    await occupying
    await flushMicrotasks()

    // It must never have opened its own picker over whatever the user moved to.
    expect(picker.isOpen()).toBe(false)
  })
})
