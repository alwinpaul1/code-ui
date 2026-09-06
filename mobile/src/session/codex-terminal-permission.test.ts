import { describe, expect, it, vi } from 'vitest'
import { sendMobileNativeChatPermissionResponse } from './mobile-native-chat-permission-send'
import type { RpcClient } from '../transport/rpc-client'
import { codexPermissionFromScreen } from './codex-terminal-permission'

const SCREEN = [
  'Would you like to run the following command?',
  '',
  'Environment: local',
  'Reason: May I run the full test suite, including the local WebSocket integration tests?',
  '',
  '  $ pnpm exec vitest run > /tmp/codeui-026-tests.log 2>&1',
  '',
  '› 1. Yes, proceed (y)',
  "  2. Yes, and don't ask again for commands that start with `pnpm exec vitest` (p)",
  '  3. No, and tell Codex what to do differently (esc)',
  '',
  'Press enter to confirm or esc to cancel'
]

describe('Codex terminal approval', () => {
  it('recognizes the screenshot without a host approval envelope', () => {
    const permission = codexPermissionFromScreen(SCREEN)
    expect(permission?.title).toBe('Run this command?')
    expect(permission?.detail).toContain('Environment: local')
    expect(permission?.detail).toContain('pnpm exec vitest run > /tmp/codeui-026-tests.log 2>&1')
    expect(permission?.options).toEqual([
      { label: 'Allow once', send: 'y' },
      {
        label: "Yes, and don't ask again for commands that start with `pnpm exec vitest`",
        send: 'p'
      },
      { label: 'Deny', send: '\x1b' }
    ])
  })
  it('does not turn transcript prose or a model picker into an approval', () => {
    expect(codexPermissionFromScreen(['Would you like to run the following command?'])).toBeNull()
    expect(codexPermissionFromScreen(['Select Model and Effort', '› 1. gpt-6-astra'])).toBeNull()
    expect(codexPermissionFromScreen(SCREEN.map((line) => line.replace('› ', '  ')))).toBeNull()
  })
  it('preserves wrapped persistent-approval scope', () => {
    const lines = [...SCREEN]
    lines.splice(
      8,
      1,
      "  2. Yes, and don't ask again for commands that start with",
      '     `pnpm exec vitest` (p)'
    )
    expect(codexPermissionFromScreen(lines)?.options[1]?.label).toContain('`pnpm exec vitest`')
  })
  it('clears the approval when the dialog is gone', () => {
    expect(codexPermissionFromScreen(['• Running tests', '› Ask Codex to do anything'])).toBeNull()
  })
})

describe('Codex approval response', () => {
  it.each(['y', 'p', '\x1b'])(
    'rechecks the live dialog and sends shortcut %s without Enter',
    async (text) => {
      const sendRequest = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, result: { terminal: { lines: SCREEN } } })
        .mockResolvedValueOnce({
          ok: true,
          result: { send: { handle: 'term', accepted: true, bytesWritten: 1 } }
        })
      const outcome = await sendMobileNativeChatPermissionResponse({
        client: { sendRequest } as unknown as RpcClient,
        terminal: 'term',
        deviceToken: 'phone',
        text,
        expectedCodexPermission: codexPermissionFromScreen(SCREEN)
      })
      expect(outcome).toBe('accepted')
      expect(sendRequest).toHaveBeenLastCalledWith(
        'terminal.send',
        expect.objectContaining({ text, enter: false }),
        expect.anything()
      )
    }
  )
  it('never sends an approval for a changed command', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        terminal: {
          lines: SCREEN.map((line) => line.replace('pnpm exec vitest run', 'different-command'))
        }
      }
    })
    const outcome = await sendMobileNativeChatPermissionResponse({
      client: { sendRequest } as unknown as RpcClient,
      terminal: 'term',
      deviceToken: 'phone',
      text: 'y',
      expectedCodexPermission: codexPermissionFromScreen(SCREEN)
    })
    expect(outcome).toBe('rejected')
    expect(sendRequest).toHaveBeenCalledOnce()
  })
})
