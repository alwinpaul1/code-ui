import { describe, expect, it } from 'vitest'
import {
  findClaudePlanFeedbackOption,
  isClaudePlanFeedbackOptionLabel
} from './claude-plan-permission'
import type { MobileChatPermission } from './mobile-native-chat-permission'

// Captured from a live `claude --permission-mode plan` session, Claude Code
// 2.1.276, via tmux capture-pane against the real binary (2026-09-18). Two
// independent plan proposals produced this identical three-option review.
const PLAN_REVIEW_OPTIONS: MobileChatPermission['options'] = [
  { label: 'Yes, and use auto mode', send: '1' },
  { label: 'Yes, manually approve edits', send: '2' },
  // The screen wraps a hint onto the next line ("shift+tab to approve with
  // this feedback"), which the existing continuation-line parser folds onto
  // the option label — so the real label the app hands this code can carry
  // that suffix.
  { label: 'Tell Claude what to change shift+tab to approve with this feedback', send: '3' }
]

describe('Claude Code plan review feedback option', () => {
  it('finds "Tell Claude what to change" among the plan review choices', () => {
    expect(isClaudePlanFeedbackOptionLabel('Tell Claude what to change')).toBe(true)
    expect(isClaudePlanFeedbackOptionLabel(PLAN_REVIEW_OPTIONS[2]!.label)).toBe(true)
    expect(
      findClaudePlanFeedbackOption({ title: 'Permission requested', options: PLAN_REVIEW_OPTIONS })
    ).toEqual(PLAN_REVIEW_OPTIONS[2])
  })

  it('does not fire on the Bash/Edit dialogs’ differently-worded reject option', () => {
    // Real captured wording (mobile-terminal-permission-options.test.ts).
    const bashOptions: MobileChatPermission['options'] = [
      { label: 'Yes', send: '1' },
      {
        label: "Yes, and don't ask again for rm commands in /Users/alwinpaul/Desktop/Project/Code UI",
        send: '2'
      },
      { label: 'No, and tell Claude what to do differently (esc)', send: '3' }
    ]
    expect(isClaudePlanFeedbackOptionLabel(bashOptions[2]!.label)).toBe(false)
    expect(findClaudePlanFeedbackOption({ title: 'Allow Bash?', options: bashOptions })).toBeNull()
  })

  it('does not fire on an ordinary yes/no ask', () => {
    const options: MobileChatPermission['options'] = [
      { label: 'Allow', send: 'y' },
      { label: 'Deny', send: 'n' }
    ]
    expect(findClaudePlanFeedbackOption({ title: 'Permission requested', options })).toBeNull()
  })

  it('refuses on the degenerate empty option list', () => {
    expect(findClaudePlanFeedbackOption({ title: 'Permission requested', options: [] })).toBeNull()
  })

  it('does not fire on a Codex command approval — Codex has no plan-review prompt', () => {
    // codex-terminal-permission.ts's own option shape: it never offers a
    // "tell me what to change" free-text option at all.
    const codexOptions: MobileChatPermission['options'] = [
      { label: 'Allow once', send: 'y' },
      { label: "Yes, don't ask again for this command", send: 'p' },
      { label: 'Deny', send: '\x1b' }
    ]
    expect(
      findClaudePlanFeedbackOption({ title: 'Run this command?', options: codexOptions })
    ).toBeNull()
  })
})
