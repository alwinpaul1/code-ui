import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPhone } from './mobile-markdown-code-pill-phone.test-support'

// The phone model the code pill tests run on (mobile-markdown-code-pill-
// phone.test-support.ts) must send lines exactly when Fabric does, or the
// suites pass on events a phone never sends.

let renderer: ReactTestRenderer | null = null
const device = createPhone(() => renderer!)
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function paragraph(onTextLayout?: (event: unknown) => void) {
  return createElement(
    'Text',
    { style: { fontSize: 15 }, onTextLayout },
    'Run ',
    createElement(
      'View',
      { style: { paddingHorizontal: 4, borderWidth: 1 } },
      createElement('Text', { style: { fontSize: 14 } }, 'pnpm install')
    ),
    ' now.'
  )
}

describe('the phone model', () => {
  // Review of 63858e9e (F2): the model took lines as sent while the Text had
  // no onTextLayout, then held back the same lines once it had one. RN 0.86
  // (ParagraphShadowNode.cpp) measures lines, sends them and keeps them for
  // its dedup only while the prop is set, so the first lines after it is set
  // always go out.
  it('sends a Text the lines it was laid out in before it had onTextLayout, once it has it', () => {
    act(() => {
      renderer = create(paragraph())
    })
    expect(device.pass(360)).toBe(false)
    const onTextLayout = vi.fn()
    act(() => renderer!.update(paragraph(onTextLayout)))
    expect(device.pass(360)).toBe(true)
    expect(onTextLayout).toHaveBeenCalledTimes(1)
    // And not again for the same lines.
    act(() => renderer!.update(paragraph(onTextLayout)))
    expect(device.pass(360)).toBe(false)
  })
})
