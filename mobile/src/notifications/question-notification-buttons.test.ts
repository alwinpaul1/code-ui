import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { RpcClient } from '../transport/rpc-client'
import { clearLiveHostClientsForTest } from '../transport/live-host-clients'
import { loadPushNotificationsEnabled } from '../storage/preferences'
import {
  ASK_USER_QUESTION_CLEANUP,
  ASK_USER_QUESTION_CONTEXT_RING,
  ASK_USER_QUESTION_STACK_AND_LOOK,
  ASK_USER_QUESTION_WHICH_LOGO,
  CODEX_REQUEST_USER_INPUT,
  clippedByHost
} from './ask-user-question-fixtures'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import { resetHostNotificationSessionsForTests } from './notification-reconnect-catchup'
import { resetPermissionCategoriesForTests } from './permission-notification-category'

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  deleteNotificationChannelAsync: vi.fn(async () => {}),
  setNotificationChannelAsync: vi.fn(async () => undefined),
  setNotificationCategoryAsync: vi.fn(async () => undefined),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(async () => 'scheduled-1'),
  dismissNotificationAsync: vi.fn()
}))
vi.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 34 }
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined)
  }
}))
vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: vi.fn()
}))

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** The desktop's event for a question, as it arrived on the Galaxy S23. One
 *  notification id per case: the scheduler dedups on it for the process's life. */
let sequence = 0
function questionEvent(overrides: Record<string, unknown> = {}) {
  sequence += 1
  return {
    type: 'notification',
    source: 'agent-task-complete',
    title: 'NexOS / main - Claude needs input',
    body: 'Using AskUserQuestion',
    worktreeId: 'repo::/Users/x/NexOS',
    notificationId: `agent:nexos-${sequence}`,
    ...overrides
  }
}

function hostClient(args: { agent: string; interactivePrompt: string; state?: string }): {
  client: RpcClient
  deliver: (event: unknown) => void
} {
  let onEvent: ((data: unknown) => void) | null = null
  const client = {
    subscribe: vi.fn((_method: string, _params: unknown, callback: (data: unknown) => void) => {
      onEvent = callback
      return vi.fn()
    }),
    getState: vi.fn(() => 'connected'),
    sendRequest: vi.fn(async (method: string) => {
      if (method === 'terminal.list') {
        return {
          ok: true,
          result: { terminals: [{ handle: 'term-nexos', agentIdentity: args.agent }] }
        }
      }
      if (method === 'terminal.agentStatus') {
        return {
          ok: true,
          result: {
            agentStatus: { state: args.state ?? 'waiting', interactivePrompt: args.interactivePrompt }
          }
        }
      }
      return { ok: true, result: {} }
    })
  } as unknown as RpcClient
  return { client, deliver: (event) => onEvent?.(event) }
}

function scheduled() {
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  return vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[0]![0]!.content
}

function registeredCategory() {
  expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledTimes(1)
  const [identifier, actions] = vi.mocked(Notifications.setNotificationCategoryAsync).mock
    .calls[0]!
  return { identifier, actions }
}

/**
 * Galaxy S23, 2026-09-18 14:25, on the build with the permission buttons:
 * "❓ Claude needs input · NexOS / main — Using AskUserQuestion" in the shade
 * with no buttons. The question was on the host the whole time.
 */
describe('a question in the shade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLiveHostClientsForTest()
    resetHostNotificationSessionsForTests()
    resetPermissionCategoriesForTests()
    Object.assign(Platform, { OS: 'android', Version: 34 })
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
  })

  it('says the question and offers its choices as buttons, plus an Other field, none opening the app', async () => {
    const { client, deliver } = hostClient({
      agent: 'claude',
      interactivePrompt: JSON.stringify(ASK_USER_QUESTION_CONTEXT_RING)
    })
    subscribeToDesktopNotifications(client, 'host-1')
    deliver(questionEvent())
    await flush()

    const content = scheduled()
    expect(content.title).toBe('Context ring · NexOS / main')
    expect(content.body).toBe(
      'Codex only reports context via /status, not continuously. How should the context indicator work?\n' +
        '1 Tap to refresh · 2 Skip it for Codex'
    )
    const category = registeredCategory()
    expect(content.categoryIdentifier).toBe(category.identifier)
    expect(category.actions).toEqual([
      {
        identifier: 'question:0',
        buttonTitle: 'Tap to refresh',
        options: { opensAppToForeground: false }
      },
      {
        identifier: 'question:1',
        buttonTitle: 'Skip it for Codex',
        options: { opensAppToForeground: false }
      },
      {
        identifier: 'question:other',
        buttonTitle: 'Other…',
        textInput: { submitButtonTitle: 'Send', placeholder: 'Type your answer' },
        options: { opensAppToForeground: false }
      }
    ])
    expect(content.data).toEqual(
      expect.objectContaining({
        hostId: 'host-1',
        worktreeId: 'repo::/Users/x/NexOS',
        picks: { 'question:0': 0, 'question:1': 1 },
        questionKey: expect.stringContaining('Tap to refresh')
      })
    )
  })

  it('offers three buttons for three choices, shortened to fit', async () => {
    const { client, deliver } = hostClient({
      agent: 'claude',
      interactivePrompt: JSON.stringify(ASK_USER_QUESTION_WHICH_LOGO)
    })
    subscribeToDesktopNotifications(client, 'host-1')
    deliver(questionEvent())
    await flush()
    expect(registeredCategory().actions.map((a) => a.buttonTitle)).toEqual([
      'The app icon',
      'The agent session c…',
      'The notification ic…'
    ])
  })

  // A multi-select cannot be answered by one tap. The one reply field takes
  // the numbers, or words, typed in the shade; nothing opens the app.
  it('offers one Answer reply field when the choices do not fit the buttons', async () => {
    const { client, deliver } = hostClient({
      agent: 'claude',
      interactivePrompt: JSON.stringify(ASK_USER_QUESTION_CLEANUP)
    })
    subscribeToDesktopNotifications(client, 'host-1')
    deliver(questionEvent())
    await flush()

    const content = scheduled()
    expect(content.title).toBe('Cleanup · NexOS / main')
    const category = registeredCategory()
    expect(category.actions).toEqual([
      {
        identifier: 'question:answer',
        buttonTitle: 'Answer',
        textInput: {
          submitButtonTitle: 'Send',
          placeholder: 'Number(s), e.g. 2 or 1,3, or type your answer'
        },
        options: { opensAppToForeground: false }
      }
    ])
    expect(content.data).toEqual(expect.objectContaining({ picks: {} }))
  })

  it('never registers an action that opens the app, whatever the prompt', async () => {
    const { client, deliver } = hostClient({
      agent: 'claude',
      interactivePrompt: JSON.stringify(ASK_USER_QUESTION_STACK_AND_LOOK)
    })
    subscribeToDesktopNotifications(client, 'host-1')
    deliver(questionEvent())
    await flush()
    for (const action of registeredCategory().actions) {
      expect(action.options?.opensAppToForeground).toBe(false)
    }
  })

  /**
   * The host keeps the prompt on the status row after it is answered. An
   * event that arrives while the agent is already working again (the desk
   * answered before the phone looked) must not grow buttons for a question
   * nobody is asking.
   */
  it("keeps the desktop's banner when the agent has already moved on", async () => {
    const { client, deliver } = hostClient({
      agent: 'claude',
      interactivePrompt: JSON.stringify(ASK_USER_QUESTION_CONTEXT_RING),
      state: 'working'
    })
    subscribeToDesktopNotifications(client, 'host-1')
    deliver(questionEvent())
    await flush()

    const content = scheduled()
    expect(content.title).toBe('❓ Claude needs input · NexOS / main')
    expect(content).not.toHaveProperty('categoryIdentifier')
    expect(Notifications.setNotificationCategoryAsync).not.toHaveBeenCalled()
  })

  it("does the same for Codex's request_user_input, naming Codex", async () => {
    const { client, deliver } = hostClient({
      agent: 'codex',
      interactivePrompt: JSON.stringify({
        questions: [{ ...CODEX_REQUEST_USER_INPUT.questions[0]!, header: undefined }]
      })
    })
    subscribeToDesktopNotifications(client, 'host-1')
    deliver(questionEvent({ title: 'NexOS / main - Codex needs input' }))
    await flush()

    const content = scheduled()
    expect(content.title).toBe('Codex has a question · NexOS / main')
    expect(content.body).toBe('Which color do you prefer: red or blue?\n1 Blue')
    expect(registeredCategory().actions).toEqual([
      { identifier: 'question:0', buttonTitle: 'Blue', options: { opensAppToForeground: false } },
      {
        identifier: 'question:other',
        buttonTitle: 'Other…',
        textInput: { submitButtonTitle: 'Send', placeholder: 'Type your answer' },
        options: { opensAppToForeground: false }
      }
    ])
  })

  /**
   * Failure path. The host clips `interactivePrompt` at 16,000 characters, so a
   * question with long previews arrives cut mid-JSON. Then the banner stays the
   * desktop's own: no buttons, and none of ours in the data. Half a question
   * would offer the wrong choices.
   */
  it("keeps the desktop's banner when the question arrived clipped", async () => {
    const { client, deliver } = hostClient({
      agent: 'claude',
      interactivePrompt: clippedByHost(JSON.stringify(ASK_USER_QUESTION_WHICH_LOGO))
    })
    subscribeToDesktopNotifications(client, 'host-1')
    deliver(questionEvent())
    await flush()

    const content = scheduled()
    expect(content.title).toBe('❓ Claude needs input · NexOS / main')
    expect(content.body).toBe('Using AskUserQuestion')
    expect(content).not.toHaveProperty('categoryIdentifier')
    expect(content.data).not.toHaveProperty('picks')
    expect(Notifications.setNotificationCategoryAsync).not.toHaveBeenCalled()
  })
})
