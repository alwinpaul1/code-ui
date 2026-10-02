import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDrawerCloseRequest } from './use-drawer-close-request'

let request: (() => void) | null = null

function Harness(props: { visible: boolean; onClose: () => void; onHidden: () => void }) {
  request = useDrawerCloseRequest({ ...props, restore: () => {} }).requestClose
  return null
}

describe('a close requested of a sheet its parent had already hidden', () => {
  afterEach(() => {
    request = null
  })

  it('still reports the sheet hidden, since no visible change is left to do it', () => {
    const onHidden = vi.fn()
    const onClose = vi.fn()
    act(() => {
      create(createElement(Harness, { visible: false, onClose, onHidden }))
    })
    act(() => request!())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onHidden).toHaveBeenCalledTimes(1)
  })

  it('leaves the report to the exit effect while the sheet is still visible', () => {
    const onHidden = vi.fn()
    act(() => {
      create(createElement(Harness, { visible: true, onClose: vi.fn(), onHidden }))
    })
    act(() => request!())
    expect(onHidden).not.toHaveBeenCalled()
  })
})
