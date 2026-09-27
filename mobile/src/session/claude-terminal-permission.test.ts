import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { claudePermissionFromScreen } from './claude-terminal-permission'
import { sendMobileNativeChatPermissionResponse } from './mobile-native-chat-permission-send'
import { splitPermissionDetail } from './mobile-permission-detail'

/** The screen rows under the fixture's `=== screen: … ===` marker. */
function readScreen(name: string): string[] {
  const text = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
  const rows = text.split('\n')
  const marker = rows.findIndex((row) => /^=== screen: .* ===$/.test(row))
  return rows.slice(marker + 1)
}

// Claude Code 2.1.283, 2026-09-27: a background subagent's Bash prompt, which
// the phone's chat view never showed. The fixture is a TRANSCRIPTION of the
// user's screenshot, not a tmux capture (agent CLIs were off limits): the gap
// before "·", the "·" and plain versus no-break spaces are unverified. See its
// header for how the rows were taken and what in the binary they agree with.
const SUBAGENT_PROMPT = readScreen('claude-screen-subagent-bash-permission-2.1.283.txt')

const GIT_COMMAND =
  'git -C "/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/save-to-phone" log\n--oneline -1'

describe('a Bash prompt raised by a subagent (Claude Code 2.1.283)', () => {
  it('shows a card with the three choices the dialog draws, by their own digits', () => {
    expect(claudePermissionFromScreen(SUBAGENT_PROMPT)?.options).toEqual([
      { label: 'Yes', send: '1' },
      { label: 'Yes, and don’t ask again for: git *', send: '2' },
      { label: 'No', send: '3' }
    ])
  })

  it('says which agent asked and why the classifier stopped it, apart from the command', () => {
    const permission = claudePermissionFromScreen(SUBAGENT_PROMPT)
    expect(permission?.title).toBe('Allow Bash?')
    expect(permission?.description).toBe('From the general-purpose agent')
    expect(permission?.decisionReason).toBe(
      [
        'Auto mode classifier requires confirmation for this command.',
        '3 consecutive actions were blocked. Please review the transcript before continuing.',
        'Latest blocked action: [Irreversible Local Destruction]'
      ].join('\n')
    )
    // The classifier's rows carry the same `│` gutter as the command. Left in
    // the body, the card folded them into the command block.
    expect(splitPermissionDetail(permission?.detail, permission?.command)).toEqual({
      command: GIT_COMMAND,
      description: "Show the branch's latest commit"
    })
  })

  it.each(['1', '2', '3'])('answers %s after finding the same prompt still up', async (digit) => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, result: { terminal: { lines: SUBAGENT_PROMPT } } })
      .mockResolvedValueOnce({
        ok: true,
        result: { send: { handle: 'terminal', accepted: true, bytesWritten: 1 } }
      })
    await expect(
      sendMobileNativeChatPermissionResponse({
        client: { sendRequest } as unknown as RpcClient,
        terminal: 'terminal',
        deviceToken: null,
        text: digit,
        expectedTerminalAgent: 'claude',
        expectedCodexPermission: claudePermissionFromScreen(SUBAGENT_PROMPT)
      })
    ).resolves.toBe('accepted')
    expect(sendRequest).toHaveBeenLastCalledWith(
      'terminal.send',
      expect.objectContaining({ text: digit, enter: false }),
      expect.anything()
    )
  })

  it('refuses the prompt once nothing on it is selected any more', () => {
    const answered = SUBAGENT_PROMPT.map((row) => row.replace(' ❯ 1. Yes', '   1. Yes'))
    expect(claudePermissionFromScreen(answered)).toBeNull()
  })
})

describe('the other titles 2.1.283 paints on the same Bash dialog', () => {
  const titled = (title: string) =>
    SUBAGENT_PROMPT.map((row) =>
      row === ' Bash command · from the general-purpose agent' ? title : row
    )

  it.each([
    [' Bash command', undefined],
    [' Bash command (unsandboxed)', undefined],
    [' Bash command (runs on studio-mac)', undefined],
    [' Bash command · from a subagent', 'From a subagent'],
    [' Bash command · from the "nightly-review" workflow', 'From the "nightly-review" workflow'],
    [' Bash command · from a workflow', 'From a workflow'],
    [' Bash command · from a remote cloud agent', 'From a remote cloud agent'],
    [' Bash command · from the review-kit plugin', 'From the review-kit plugin'],
    [' Bash command · from a plugin', 'From a plugin'],
    [' Bash command (unsandboxed) · from the Explore agent', 'From the Explore agent']
  ])('reads %j', (title, origin) => {
    const permission = claudePermissionFromScreen(titled(title))
    expect(permission?.options.map((option) => option.send)).toEqual(['1', '2', '3'])
    expect(permission?.description).toBe(origin)
  })

  // Refused, not guessed at: the chat then says a prompt is waiting in the
  // terminal (use-mobile-native-chat-controller-terminal-wait.test.ts).
  // Unverified bytes of the transcription: the one-cell gap before "·" and the
  // space after it could come back as no-break spaces on a live read.
  it('reads the title with no-break spaces around its "·"', () => {
    const permission = claudePermissionFromScreen(
      titled(' Bash command\u00a0·\u00a0from the general-purpose agent')
    )
    expect(permission?.description).toBe('From the general-purpose agent')
  })

  it('refuses a title with a decoration it does not know', () => {
    expect(claudePermissionFromScreen(titled(' Bash command · queued'))).toBeNull()
    expect(
      claudePermissionFromScreen(titled(' Bash command · from the general-purpose agent · queued'))
    ).toBeNull()
    expect(claudePermissionFromScreen(titled(' Bash commands'))).toBeNull()
  })
})

describe("the auto-deny countdown under a classifier's reason", () => {
  // 2.1.283 draws `${NE} Claude Code will automatically deny this request in
  // ${m:ss}, to avoid blocking progress on an unattended session` inside the
  // reason block, in a box with a blank row under it, on the timed shape of
  // the denial-limit fallback (`Tt`, strings of the binary). Not seen on a
  // real screen: the prompt of 2026-09-27 had none. It ticks every second.
  const counting = (left: string) => {
    const at = SUBAGENT_PROMPT.indexOf(' Do you want to proceed?')
    return [
      ...SUBAGENT_PROMPT.slice(0, at - 1),
      '',
      ` ⚠ Claude Code will automatically deny this request in ${left}, to avoid blocking progress on`,
      ' an unattended session',
      ...SUBAGENT_PROMPT.slice(at - 1)
    ]
  }

  it('drops only the countdown, even with no blank row to end it', () => {
    const at = SUBAGENT_PROMPT.indexOf(' │ Auto mode classifier requires confirmation for this command.')
    const lines = [
      ...SUBAGENT_PROMPT.slice(0, at),
      ' ⚠ Claude Code will automatically deny this request in 4:59, to avoid blocking progress on',
      ' an unattended session',
      ...SUBAGENT_PROMPT.slice(at)
    ]
    expect(claudePermissionFromScreen(lines)?.decisionReason).toBe(
      claudePermissionFromScreen(SUBAGENT_PROMPT)?.decisionReason
    )
  })

  // An independent review (2026-09-27): once the countdown matched, every
  // note row after it went too, so a reason drawn right under it was lost.
  it('keeps a reason drawn right under the countdown', () => {
    const at = SUBAGENT_PROMPT.indexOf(' Do you want to proceed?')
    const lines = [
      ...SUBAGENT_PROMPT.slice(0, at - 1),
      '',
      ' ⚠ Claude Code will automatically deny this request in 4:59, to avoid blocking progress on',
      ' an unattended session',
      ' Permission rule Bash(git *) requires confirmation for this command.',
      ...SUBAGENT_PROMPT.slice(at - 1)
    ]
    const reason = claudePermissionFromScreen(lines)?.decisionReason
    expect(reason).toContain('Permission rule Bash(git *) requires confirmation for this command.')
    expect(reason).not.toMatch(/automatically deny|unattended/)
  })

  it('keeps a reason under a countdown that wrapped between "unattended" and "session"', () => {
    const at = SUBAGENT_PROMPT.indexOf(' Do you want to proceed?')
    const lines = [
      ...SUBAGENT_PROMPT.slice(0, at - 1),
      '',
      ' ⚠ Claude Code will automatically deny this request in 4:59, to avoid blocking progress on an unattended',
      ' session',
      ' Permission rule Bash(git *) requires confirmation for this command.',
      ...SUBAGENT_PROMPT.slice(at - 1)
    ]
    const reason = claudePermissionFromScreen(lines)?.decisionReason
    expect(reason).toContain('Permission rule Bash(git *) requires confirmation for this command.')
    expect(reason).not.toMatch(/automatically deny|unattended|^session$/m)
  })

  it('keeps the card the same prompt from one second to the next', () => {
    const first = claudePermissionFromScreen(counting('4:59'))
    expect(first).not.toBeNull()
    expect(JSON.stringify(claudePermissionFromScreen(counting('4:58')))).toBe(JSON.stringify(first))
    expect(first?.decisionReason).not.toMatch(/automatically deny|unattended/)
    expect(first?.detail).not.toMatch(/automatically deny|unattended/)
  })
})
