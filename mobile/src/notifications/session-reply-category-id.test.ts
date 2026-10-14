import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-notifications', () => ({ setNotificationCategoryAsync: vi.fn(async () => undefined) }))

import { ensurePermissionCategory, resetPermissionCategoriesForTests } from './permission-notification-category'
import { SESSION_REPLY_ACTION, isSessionReplyCategory, sessionReplyHint } from './session-reply-notification'

// isSessionReplyCategory reads an id that permission-notification-category.ts builds, so it is tested
// against that builder's own output, for every agent's hint, and not against a string typed here.

beforeEach(() => {
  resetPermissionCategoriesForTests()
})

describe('telling the Reply’s category from the others', () => {
  it.each([null, 'claude', 'codex', 'openclaude'])('knows the id the builder makes for %s', async (agent) => {
    const id = await ensurePermissionCategory([
      { identifier: SESSION_REPLY_ACTION, label: 'Reply', textInput: { placeholder: sessionReplyHint(agent) } }
    ])
    expect(id).not.toBeNull()
    expect(isSessionReplyCategory(id!)).toBe(true)
  })

  it('does not take a permission’s buttons for it, with or without the comment field', async () => {
    const plain = await ensurePermissionCategory([
      { identifier: 'permission:0', label: 'Allow' },
      { identifier: 'permission:1', label: 'Deny' }
    ])
    const withComment = await ensurePermissionCategory([
      { identifier: 'permission:1', label: 'Deny' },
      {
        identifier: 'permission-comment',
        label: 'Deny with comment',
        textInput: { placeholder: 'Tell Claude what to do instead' }
      }
    ])
    expect(isSessionReplyCategory(plain!)).toBe(false)
    expect(isSessionReplyCategory(withComment!)).toBe(false)
  })

  it('does not take a question’s answer field for it', async () => {
    const question = await ensurePermissionCategory([
      { identifier: 'question:answer', label: 'Answer', textInput: { placeholder: 'Type your answer' } }
    ])
    expect(isSessionReplyCategory(question!)).toBe(false)
  })
})
