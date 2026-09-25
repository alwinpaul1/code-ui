// The drawer's own half of MobileNativeChatSessionOptionPickers.failure.test.tsx,
// over a stand-in controller: what every lane gets from the picker, whatever
// it drives. The real chain (the send seam, the option controller and Codex's
// driver) is in that file; the structured lane's own refusal is in
// use-mobile-structured-agent-session-option-refusal.test.tsx.

import { createElement, useState, type ReactElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'
import { MobileNativeChatSessionOptionPickers } from './MobileNativeChatSessionOptionPickers'
import type { PickFailureReport } from './session-option-pick-failure'
import * as sheetFailure from './use-sheet-failure'
import type { MobileNativeChatSessionOptionsController } from './use-mobile-native-chat-session-options'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Keyboard: { dismiss: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  X: 'X'
}))
// The drawer's native window cannot mount here; a host element in its place
// keeps what the drawer holds findable, and what it does not.
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, children }: { visible: boolean; children?: ReactNode }) =>
      visible ? React.createElement('BottomDrawer', { visible }, children) : null
  }
})

const BUSY = 'Another input is still being sent. Try again.'
const NOT_SENT = 'Message not sent'
const UNCONFIRMED = 'Command unconfirmed — check chat before retrying'

const noop = (): void => undefined
const TAB = 'host-a\0wt-1\0tab-1'
// The chat's own banner-or-toast reporter, which draws under the drawer.
const screen = vi.fn<(message: string) => void>()

let renderer: ReactTestRenderer | null = null
// The drawer's own clock (use-sheet-failure.ts), moved only by lookFor.
let pickClock = 0

beforeEach(() => {
  screen.mockReset()
  pickClock = 0
  sheetFailure.setSheetFailureClockForTests?.(() => pickClock)
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
  sheetFailure.setSheetFailureClockForTests?.(null)
})

/** Let `ms` pass: on the drawer's own clock, and on the wall clock with it.
 *  Timers stay real. */
function lookFor(ms: number): void {
  pickClock += ms
  if (!vi.isFakeTimers()) {
    vi.useFakeTimers({ toFake: ['Date'] })
  }
  vi.setSystemTime(Date.now() + ms)
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Host tags are the strings the react-native mock above renders. */
function isHost(node: ReactTestInstance, tag: string): boolean {
  return (node.type as unknown) === tag
}

function drawer(): ReactTestInstance | null {
  return renderer!.root.findAllByType('BottomDrawer' as never)[0] ?? null
}

/** The Text that says `message`, wherever in the tree it is drawn. */
function said(message: string): ReactTestInstance[] {
  return renderer!.root
    .findAllByType('Text' as never)
    .filter((node) => node.props.children === message)
}

function isInside(node: ReactTestInstance, type: string): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isHost(parent, type)) {
      return true
    }
  }
  return false
}

function pressable(label: string): ReactTestInstance {
  return renderer!.root.find(
    (node) =>
      isHost(node, 'Pressable') &&
      typeof node.props.accessibilityLabel === 'string' &&
      node.props.accessibilityLabel.startsWith(label)
  )
}

function row(text: string): ReactTestInstance {
  const label = renderer!.root
    .findAllByType('Text' as never)
    .find((node) => node.props.children === text)
  let parent = label?.parent ?? null
  while (parent && !isHost(parent, 'Pressable')) {
    parent = parent.parent
  }
  if (!parent) {
    throw new Error(`No pressable row for ${text}`)
  }
  return parent
}

async function press(node: ReactTestInstance): Promise<void> {
  await act(async () => {
    node.props.onPress()
  })
  await settle()
}

async function openDrawer(): Promise<void> {
  await press(pressable('Model'))
  expect(drawer()).not.toBeNull()
}

/** Where a failed pick's message was drawn: inside the drawer, or not at all. */
function expectSaidInDrawer(message: string): void {
  expect(said(message).map((node) => isInside(node, 'BottomDrawer'))).toEqual([true])
}

describe('the drawer, whatever lane it drives', () => {
  const MODEL: SessionOptionDescriptor = {
    id: 'model',
    label: 'Model',
    category: 'model',
    kind: {
      type: 'select',
      currentValue: 'sonnet',
      choices: [
        { value: 'sonnet', label: 'Sonnet 5' },
        { value: 'opus', label: 'Opus 4.8' }
      ]
    },
    valueSource: 'reported',
    transport: 'agent-session',
    settable: true
  }

  async function mountPicker(
    snapshot: SessionOptionDescriptor[],
    lane: Pick<MobileNativeChatSessionOptionsController, 'setOption' | 'invokeAction'>
  ): Promise<void> {
    const controller: MobileNativeChatSessionOptionsController = {
      snapshot,
      pendingId: null,
      ...lane,
      recordCommand: noop
    }
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatSessionOptionPickers, {
          controller,
          isWorking: false,
          reportFailure: screen,
          scopeKey: TAB
        })
      )
    })
    await openDrawer()
  }

  // The structured lane refuses on the host (agentSession.setOption), and its
  // controller is handed to the picker as it is; the picker must give every
  // lane the same place to say why.
  it('hands each pick a reporter and draws what it says inside the drawer', async () => {
    const setOption = vi.fn<MobileNativeChatSessionOptionsController['setOption']>(
      async (_id, _value, report) => {
        report?.('The host refused that model')
        return false
      }
    )
    await mountPicker([MODEL], { setOption, invokeAction: async () => false })

    await press(row('Opus 4.8'))

    expect(setOption).toHaveBeenCalledWith('model', 'opus', expect.any(Function))
    expectSaidInDrawer('The host refused that model')
    expect(screen).not.toHaveBeenCalled()
  })

  // The one row an agent-picker model shows: it types the agent's own `/model`.
  it("says why the agent-picker row did not open the agent's picker, inside the drawer", async () => {
    const invokeAction = vi.fn<MobileNativeChatSessionOptionsController['invokeAction']>(
      async (_id, report) => {
        report?.(BUSY)
        return false
      }
    )
    await mountPicker(
      [
        {
          ...MODEL,
          kind: { type: 'select', choices: [] },
          valueSource: 'unknown',
          action: { type: 'agent-picker' }
        }
      ],
      { setOption: async () => false, invokeAction }
    )

    await press(row('Choose in agent picker…'))

    expect(invokeAction).toHaveBeenCalledWith('model', expect.any(Function))
    expect(drawer()).not.toBeNull()
    expectSaidInDrawer(BUSY)
    expect(screen).not.toHaveBeenCalled()
  })

  // The agent-picker row flips the tab to its terminal view when it lands, and
  // an ack-lost one says so on the way: the word and the unmount of the chat,
  // picker and all, reach React in the same render.
  it('does not repeat a failure the user has read when the picker unmounts', async () => {
    let hide: () => void = noop
    function Host(): ReactElement | null {
      const [shown, setShown] = useState(true)
      hide = () => setShown(false)
      return shown
        ? createElement(MobileNativeChatSessionOptionPickers, {
            controller: {
              snapshot: [MODEL],
              pendingId: null,
              setOption: async (_id, _value, report) => {
                report?.(BUSY)
                return false
              },
              invokeAction: async () => false,
              recordCommand: noop
            },
            isWorking: false,
            reportFailure: screen,
            scopeKey: TAB
          })
        : null
    }
    await act(async () => {
      renderer = create(createElement(Host))
    })
    await openDrawer()
    await press(row('Opus 4.8'))
    expectSaidInDrawer(BUSY)
    lookFor(2_000)

    await act(async () => {
      hide()
    })

    expect(renderer!.toJSON()).toBeNull()
    expect(screen).not.toHaveBeenCalled()
  })

  // Whether a failure was read turns on when the drawer drew it, not on when
  // the pick said it: a stalled JS thread (or a clock jump) in between must not
  // pass a failure nobody saw off as read.
  it('hands on a failure the drawer never drew, however long the thread stalled first', async () => {
    let report: PickFailureReport | undefined
    let settlePick: (applied: boolean) => void = noop
    await mountPicker([MODEL], {
      setOption: (_id, _value, pickReport) => {
        report = pickReport
        return new Promise<boolean>((resolve) => {
          settlePick = resolve
        })
      },
      invokeAction: async () => false
    })
    await press(row('Opus 4.8'))
    await press(pressable('Close picker'))

    await act(async () => {
      report!(NOT_SENT)
      settlePick(false)
      lookFor(1_500)
    })
    await settle()

    expect(screen).toHaveBeenCalledTimes(1)
    expect(screen).toHaveBeenCalledWith(NOT_SENT)
  })

  it('hands a failure said in the render that unmounts the picker to the chat', async () => {
    let hide: () => void = noop
    function Host(): ReactElement | null {
      const [shown, setShown] = useState(true)
      hide = () => setShown(false)
      return shown
        ? createElement(MobileNativeChatSessionOptionPickers, {
            controller: {
              snapshot: [
                {
                  ...MODEL,
                  kind: { type: 'select', choices: [] },
                  valueSource: 'unknown',
                  action: { type: 'agent-picker' }
                }
              ],
              pendingId: null,
              setOption: async () => false,
              invokeAction: async (_id, report) => {
                report?.(UNCONFIRMED)
                hide()
                // The thread stalls before React commits the unmount.
                lookFor(1_500)
                return true
              },
              recordCommand: noop
            },
            isWorking: false,
            reportFailure: screen,
            scopeKey: TAB
          })
        : null
    }
    await act(async () => {
      renderer = create(createElement(Host))
    })
    await openDrawer()

    await press(row('Choose in agent picker…'))

    expect(renderer!.toJSON()).toBeNull()
    expect(screen).toHaveBeenCalledTimes(1)
    expect(screen).toHaveBeenCalledWith(UNCONFIRMED)
  })
})
