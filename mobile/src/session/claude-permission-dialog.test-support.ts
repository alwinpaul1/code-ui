import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** One captured frame by name, from the `=== screen: <name> ===` markers of
 *  fixtures/claude-screen-permission-amend-2.1.299.txt (Claude Code 2.1.299, tmux capture-pane -p,
 *  2026-10-14). Its rows are the pane's, blank edges trimmed. */
export function capturedScreen(name: string): string[] {
  const text = readFileSync(
    fileURLToPath(new URL('./fixtures/claude-screen-permission-amend-2.1.299.txt', import.meta.url)),
    'utf8'
  )
  const rows = text.split('\n')
  const start = rows.findIndex((row) => row.startsWith(`=== screen: ${name} ===`))
  if (start === -1) {
    throw new Error(`frame ${name} is not in the fixture`)
  }
  const next = rows.findIndex((row, at) => at > start && row.startsWith('=== screen: '))
  const frame = rows.slice(start + 1, next === -1 ? undefined : next)
  return frame.at(-1) === '' ? frame.slice(0, -1) : frame
}
