import type { MobileChatPermission } from './mobile-native-chat-permission'

type ScreenOption = { digit: string; text: string }

const OPTION_LINE = /^\s*[❯›>]?\s*(\d)[.)]\s+(.+?)\s*$/
const CONTINUATION = /^\s{2,}(\S.*?)\s*$/

/**
 * The numbered choices of Claude Code's permission dialog as drawn on the
 * terminal screen ("❯ 1. Yes / 2. Yes, and don't ask again for … / 3. No, and
 * tell Claude what to do differently"). Long options wrap onto indented
 * continuation lines, which are folded back into their option.
 */
export function parseTerminalDialogOptions(lines: readonly string[]): ScreenOption[] {
  const options: ScreenOption[] = []
  let last: ScreenOption | null = null
  for (const raw of lines) {
    const match = OPTION_LINE.exec(raw)
    if (match) {
      const digit = match[1]!
      // Options are 1..n in order; a repeat means an unrelated list further down.
      if (options.length > 0 && Number(digit) !== options.length + 1) {
        if (Number(digit) === 1) {
          options.length = 0
        } else {
          last = null
          continue
        }
      }
      last = { digit, text: match[2]! }
      options.push(last)
      continue
    }
    const more = last ? CONTINUATION.exec(raw) : null
    if (more && !/^\d[.)]/.test(more[1]!) && !/^[❯›>]/.test(more[1]!)) {
      last!.text = `${last!.text} ${more[1]!}`
    } else {
      last = null
    }
  }
  return options
}

function isAlways(text: string): boolean {
  return /\balways\b|don't ask again|do not ask again|allow all\b|this session/i.test(text)
}

/**
 * Map the dialog's options onto the card: Allow (Yes), Allow all (the "don't
 * ask again" / "always allow" variant) and Deny (No), each sending its real
 * digit. Null when the screen shows no yes/no dialog, so the caller keeps the
 * generic Allow/Deny pair.
 */
export function permissionOptionsFromScreen(
  lines: readonly string[]
): MobileChatPermission['options'] | null {
  const options = parseTerminalDialogOptions(lines)
  const yes = options.find((option) => /^yes\b/i.test(option.text) && !isAlways(option.text))
  const always = options.find((option) => /^yes\b/i.test(option.text) && isAlways(option.text))
  const no = options.find((option) => /^no\b/i.test(option.text))
  if (!yes || !no) {
    return null
  }
  const result: MobileChatPermission['options'] = [{ label: 'Allow', send: yes.digit }]
  if (always) {
    result.push({ label: 'Allow all', send: always.digit })
  }
  result.push({ label: 'Deny', send: no.digit })
  return result
}
