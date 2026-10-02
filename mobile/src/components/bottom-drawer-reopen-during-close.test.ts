import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BottomDrawer } from './BottomDrawer'

vi.mock('./mounted-bottom-drawer', () => ({
  MountedBottomDrawer: 'MountedBottomDrawer'
}))

function DrawerContent(): null {
  return null
}

function drawer(visible: boolean, onAfterClose: () => void) {
  return createElement(BottomDrawer, {
    visible,
    onClose: () => {},
    onAfterClose,
    children: createElement(DrawerContent)
  })
}

// The mock above makes the mounted drawer a host element named after it.
function mountedDrawer(renderer: ReactTestRenderer) {
  const [found] = renderer.root.findAll((node) => String(node.type) === 'MountedBottomDrawer')
  return found!
}

// The close animation finishes on the UI thread and reaches `onHidden` through
// runOnJS, a task later. A sheet reopened in between has a hide report from its
// PREVIOUS close still in flight. It used to leave the drawer believing this
// close had already been reported, so the NEXT close was dropped: the sheet sat
// mounted at progress 0, a full-screen Modal with nothing drawn that ate every
// tap, and the `onAfterClose` a hand-off waits on never came.
describe('a sheet reopened while its last hide report is still in flight', () => {
  beforeEach(() => {
    const originalConsoleError = console.error
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      const message = args[0]
      if (typeof message === 'string' && message.includes('not configured to support act')) {
        return
      }
      originalConsoleError(...args)
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('still unmounts on the next close, and delivers onAfterClose once, after it', () => {
    const afterClose = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(drawer(true, afterClose))
    })
    const onHidden = mountedDrawer(renderer).props.onHidden as () => void

    act(() => renderer.update(drawer(false, afterClose)))
    act(() => renderer.update(drawer(true, afterClose)))
    // The first close's report lands after the reopen.
    act(() => onHidden())

    expect(renderer.toJSON(), 'the reopened sheet stays up').not.toBeNull()
    expect(afterClose, 'no hand-off while the sheet is open').not.toHaveBeenCalled()

    act(() => renderer.update(drawer(false, afterClose)))
    act(() => onHidden())

    expect(renderer.toJSON(), 'the second close unmounts the sheet').toBeNull()
    expect(afterClose).toHaveBeenCalledTimes(1)
  })

  it('still delivers one close once, however many times it is reported', () => {
    const afterClose = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(drawer(true, afterClose))
    })
    const onHidden = mountedDrawer(renderer).props.onHidden as () => void
    act(() => renderer.update(drawer(false, afterClose)))
    act(() => {
      onHidden()
      onHidden()
    })
    expect(renderer.toJSON()).toBeNull()
    expect(afterClose).toHaveBeenCalledTimes(1)
  })
})
