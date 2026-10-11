import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  useWindowDimensions: () => ({ width: 412, height: 900 })
}))

import { MobileNativeChatAgentImageTile } from './MobileNativeChatImageStrip'
import { peekImagePreview, resetImagePreviewForTests } from './image-preview-store'
import { peekImageMarkup, resetImageMarkupForTests } from './image-markup-store'
import { resetChatMarkupAttachTargetForTests, setChatMarkupAttachTarget } from './chat-image-markup-target'

// The Claude app's viewer has a pencil left of its download button (the
// user's screenshots, 2026-10-11): "like we have already". Code UI has the
// editor (MobileImageMarkupEditor, opened from a composer chip) but the
// viewer drew its pencil only for a composer chip, never for a picture the
// agent read or sent.

const URI = 'file:///cache/codeui-host-image-where.png'

describe('marking up a picture the agent sent', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    resetImagePreviewForTests()
    resetImageMarkupForTests()
    resetChatMarkupAttachTargetForTests()
  })
  const tapTile = () => {
    act(() => {
      renderer = create(<MobileNativeChatAgentImageTile uri={URI} label="Image the agent sent" />)
    })
    act(() => renderer!.root.findByProps({ accessibilityRole: 'imagebutton' }).props.onPress())
  }

  it('opens the viewer with a pencil that opens the editor on that picture, and Done attaches the drawing to the composer', () => {
    const attach = vi.fn(async () => undefined)
    setChatMarkupAttachTarget(attach)
    tapTile()
    const preview = peekImagePreview()
    expect(preview?.uri).toBe(URI)
    expect(preview?.onEdit).toBeTypeOf('function')
    act(() => preview!.onEdit!())
    expect(peekImageMarkup()?.uri).toBe(URI)
    peekImageMarkup()!.onDone({ base64: 'iVBORw0KGgo=' })
    expect(attach).toHaveBeenCalledWith('iVBORw0KGgo=')
  })

  it('draws no pencil when no chat composer can take the drawing', () => {
    tapTile()
    expect(peekImagePreview()?.onEdit).toBeUndefined()
  })

  it('says where the drawing went when the chat closed while it was drawn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const unregister = setChatMarkupAttachTarget(vi.fn(async () => undefined))
    tapTile()
    act(() => peekImagePreview()!.onEdit!())
    unregister()
    peekImageMarkup()!.onDone({ base64: 'iVBORw0KGgo=' })
    expect(warn.mock.calls.some((call) => String(call[0]).includes('no composer'))).toBe(true)
    warn.mockRestore()
  })
})
