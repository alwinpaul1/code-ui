import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { claudePermissionFromScreen } from './claude-terminal-permission'
import { codexPermissionFromScreen } from './codex-terminal-permission'
import { MobileNativeChatPermission } from './MobileNativeChatPermission'
import { parseApprovalFromStatus, type MobileChatPermission } from './mobile-native-chat-permission'
import { permissionOptionsFromScreen } from './mobile-terminal-permission-options'
import { withTerminalDialogOptions } from './mobile-terminal-permission-options-merge'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))
vi.mock('lucide-react-native', () => ({ ShieldQuestion: 'ShieldQuestion', X: 'X' }))
vi.mock('../components/TextInputModal', () => ({ TextInputModal: 'TextInputModal' }))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))

/** The screen rows under the fixture's `=== screen: … ===` marker. */
function readScreen(name: string): string[] {
  const text = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
  const rows = text.split('\n')
  return rows.slice(rows.findIndex((row) => /^=== screen: .* ===$/.test(row)) + 1)
}

// Claude Code 2.1.283, 2026-09-27. Its second choice, "Yes, and don’t ask
// again for: git *", writes an allow rule to the project's local settings
// (`destination:"localSettings"` in the binary): it lasts past this session.
// (A transcription of the user's screenshot, not a tmux capture; see the
// fixture's header for the bytes it cannot vouch for.)
const SUBAGENT_PROMPT = readScreen('claude-screen-subagent-bash-permission-2.1.283.txt')

// Codex's persistent choice, from a screenshot (codex-terminal-permission.test.ts).
const CODEX_PROMPT = [
  'Would you like to run the following command?',
  '',
  '  $ pnpm exec vitest run > /tmp/codeui-026-tests.log 2>&1',
  '',
  '› 1. Yes, proceed (y)',
  "  2. Yes, and don't ask again for commands that start with `pnpm exec vitest` (p)",
  '  3. No, and tell Codex what to do differently (esc)',
  '',
  'Press enter to confirm or esc to cancel'
]

describe('what the card calls a choice that remembers a rule', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function drawn(permission: MobileChatPermission, scheme: 'light' | 'dark' = 'light') {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatPermission permission={permission} onRespond={vi.fn(async () => true)} />
        </ThemeProvider>
      )
    })
    const buttons = renderer!.root.findAll((node) => String(node.type) === 'Pressable')
    return buttons.map((button) => ({
      send: permission.options.find((option) => option.label === button.props.accessibilityLabel)?.send,
      text: button
        .findAll((node) => String(node.type) === 'Text')
        .map((node) => String(node.props.children))
        .join('')
    }))
  }

  it.each(['light', 'dark'] as const)(
    'says what the screen says for a rule saved to the project, never "this session", in %s',
    (scheme) => {
      const buttons = drawn(claudePermissionFromScreen(SUBAGENT_PROMPT)!, scheme)
      expect(buttons.find((button) => button.send === '2')?.text).toBe(
        'Yes, and don’t ask again for: git *'
      )
      expect(buttons.some((button) => /this session/i.test(button.text))).toBe(false)
    }
  )

  it("says what Codex's screen says for its remembered prefix", () => {
    const buttons = drawn(codexPermissionFromScreen(CODEX_PROMPT)!)
    expect(buttons.find((button) => button.send === 'p')?.text).toBe(
      "Yes, and don't ask again for commands that start with `pnpm exec vitest`"
    )
    expect(buttons.some((button) => /this session/i.test(button.text))).toBe(false)
  })

  // The hook envelope's own card offers no remembered rule at all; once the
  // screen's choices replace its Allow/Deny, the screen's words carry through.
  it('keeps the screen’s words when the card came from the hook envelope', () => {
    const envelope = parseApprovalFromStatus(
      JSON.stringify({ approval: { tool: 'Bash', summary: 'git log --oneline -1' } })
    )!
    expect(drawn(envelope).map((button) => button.text)).toEqual(['Allow', 'Deny'])
    const merged = withTerminalDialogOptions(envelope, permissionOptionsFromScreen(SUBAGENT_PROMPT))!
    act(() => renderer?.unmount())
    expect(drawn(merged).map((button) => button.text)).toEqual([
      'Allow once',
      'Yes, and don’t ask again for: git *',
      'Deny'
    ])
  })
})
