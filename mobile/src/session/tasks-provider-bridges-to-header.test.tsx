import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The header menu's Background tasks entry (parity gap G35) opens the sheet the chat's tasks
// provider owns. The provider must publish its running count and opener to the header bridge,
// and take them back when the chat goes away.

const sheet = vi.hoisted(() => ({ visible: [] as boolean[] }))
const running = vi.hoisted(() => ({ tasks: [] as { id: string; kind: string }[] }))

vi.mock('./use-mobile-running-task-count', () => ({ useMobileRunningTasks: () => running.tasks }))
vi.mock('./MobileBackgroundTasksSheet', () => ({
  MobileBackgroundTasksSheet: (props: { visible: boolean }) => {
    sheet.visible.push(props.visible)
    return null
  }
}))
vi.mock('./MobileNativeChatRunSheet', () => ({ MobileNativeChatRunSheet: () => null }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: () => null }))
vi.mock('./MobileBackgroundShellOutputSheet', () => ({ MobileBackgroundShellOutputSheet: () => null }))
vi.mock('./MobileNativeChatAgentToolCalls', () => ({ MobileNativeChatAgentToolCalls: () => null }))
vi.mock('./subagent-transcript-store', () => ({
  followSubagentTranscriptRunning: () => () => {},
  openSubagentTranscript: () => {}
}))

import { MobileNativeChatTasksProvider } from './MobileNativeChatTasksProvider'
import { useHeaderBackgroundTasks, type HeaderBackgroundTasks } from './session-header-tasks-bridge'

let renderers: ReactTestRenderer[] = []
afterEach(() => {
  act(() => renderers.forEach((renderer) => renderer.unmount()))
  renderers = []
  sheet.visible.length = 0
})

function header() {
  const seen: HeaderBackgroundTasks[] = []
  function Header(): null {
    seen.push(useHeaderBackgroundTasks())
    return null
  }
  act(() => {
    renderers.push(create(createElement(Header)))
  })
  return seen
}

describe('the chat’s tasks provider bridges its sheet to the header menu', () => {
  it('publishes the running count, and the header’s open shows its sheet', () => {
    running.tasks = [
      { id: 'shell-1', kind: 'shell' },
      { id: 'agent-1', kind: 'agent' }
    ]
    const seen = header()
    let provider: ReactTestRenderer | null = null
    act(() => {
      provider = create(
        <MobileNativeChatTasksProvider messages={[]} agent="claude" agentWorking>
          {null}
        </MobileNativeChatTasksProvider>
      )
    })
    expect(seen.at(-1)?.runningCount).toBe(2)
    expect(sheet.visible.at(-1)).toBe(false)
    act(() => seen.at(-1)?.open?.())
    expect(sheet.visible.at(-1)).toBe(true)
    act(() => provider!.unmount())
    expect(seen.at(-1)).toEqual({ runningCount: 0, open: null })
  })

  it('publishes zero when nothing runs, so the header offers no entry', () => {
    running.tasks = []
    const seen = header()
    act(() => {
      renderers.push(
        create(
          <MobileNativeChatTasksProvider messages={[]} agent="claude" agentWorking={false}>
            {null}
          </MobileNativeChatTasksProvider>
        )
      )
    })
    expect(seen.at(-1)?.runningCount).toBe(0)
  })
})
