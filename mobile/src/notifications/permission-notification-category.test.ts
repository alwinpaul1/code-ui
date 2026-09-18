import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import {
  ensurePermissionCategory,
  resetPermissionCategoriesForTests
} from './permission-notification-category'

vi.mock('expo-notifications', () => ({
  setNotificationCategoryAsync: vi.fn(async () => undefined)
}))

const ALLOW_DENY_PERMISSION = [
  { identifier: 'permission:0', label: 'Allow' },
  { identifier: 'permission:1', label: 'Deny' }
]

/** A question whose options happen to read like a permission's. */
const ALLOW_DENY_QUESTION = [
  { identifier: 'question:0', label: 'Allow' },
  { identifier: 'question:1', label: 'Deny' }
]

describe('registering a banner’s buttons with the OS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPermissionCategoriesForTests()
  })

  /**
   * The id used to be built from the labels alone, so a question whose
   * options read Allow / Deny inherited the permission's category — and with
   * it the permission's action identifiers. Its buttons then came back as
   * `permission:0`, which the question path does not answer and the
   * permission path refuses as not its prompt: dead and silent (review
   * finding F1, 2026-09-18). What a button DOES is part of what it is.
   */
  it('gives a question and a permission with the same labels different categories', async () => {
    const permission = await ensurePermissionCategory(ALLOW_DENY_PERMISSION)
    const question = await ensurePermissionCategory(ALLOW_DENY_QUESTION)
    expect(permission).not.toBeNull()
    expect(question).not.toBeNull()
    expect(question).not.toBe(permission)
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledTimes(2)
  })

  it('registers the same buttons once and hands back the same id', async () => {
    const first = await ensurePermissionCategory(ALLOW_DENY_PERMISSION)
    const again = await ensurePermissionCategory(ALLOW_DENY_PERMISSION)
    expect(again).toBe(first)
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledTimes(1)
  })

  it('registers a reply field as a text input the user answers in the shade', async () => {
    await ensurePermissionCategory([
      { identifier: 'question:other', label: 'Other…', textInput: { placeholder: 'Type your answer' } }
    ])
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledWith(expect.any(String), [
      {
        identifier: 'question:other',
        buttonTitle: 'Other…',
        textInput: { submitButtonTitle: 'Send', placeholder: 'Type your answer' },
        options: { opensAppToForeground: false }
      }
    ])
  })

  it('keeps a reply field apart from a plain button with the same label', async () => {
    const plain = await ensurePermissionCategory([{ identifier: 'question:answer', label: 'Answer' }])
    const reply = await ensurePermissionCategory([
      { identifier: 'question:answer', label: 'Answer', textInput: { placeholder: 'x' } }
    ])
    expect(reply).not.toBe(plain)
  })

  /**
   * "user can reply directly from the notification dont open the app"
   * (2026-09-18). No action this module registers may bring the app to the
   * front; every one is answered in the shade. Pinned on the source, since a
   * flag on an object literal has no behavioural handle in a mocked OS.
   */
  it('never registers an action that opens the app', () => {
    const source = readFileSync(
      new URL('./permission-notification-category.ts', import.meta.url),
      'utf8'
    )
    // The one place the flag is set, and what it is set to. The comment above
    // it names the flag too; only the code form is matched.
    expect(source.match(/opensAppToForeground:\s*(true|false|[a-zA-Z])/g)).toEqual([
      'opensAppToForeground: false'
    ])
  })

  it('registers nothing for an empty set', async () => {
    expect(await ensurePermissionCategory([])).toBeNull()
    expect(Notifications.setNotificationCategoryAsync).not.toHaveBeenCalled()
  })

  it('returns null when the OS refuses, and tries again next time', async () => {
    vi.mocked(Notifications.setNotificationCategoryAsync).mockRejectedValueOnce(new Error('no'))
    expect(await ensurePermissionCategory(ALLOW_DENY_PERMISSION)).toBeNull()
    expect(await ensurePermissionCategory(ALLOW_DENY_PERMISSION)).not.toBeNull()
  })
})
