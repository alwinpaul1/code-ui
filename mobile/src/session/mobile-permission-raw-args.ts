/**
 * A tool's input on a permission card, the way the Claude app 1.261009.20
 * draws a request it has no special face for (uuy): each argument as its name
 * over its value, the first six, each value cut at 150 characters with a "…",
 * then "+ N more arguments" (`ccr_tool_approval_raw_args_overflow`) and a
 * "Show full input" / "Show less" toggle (`ccr_tool_approval_raw_args_show_full`)
 * that opens every argument whole. At most 50 arguments are listed even then.
 *
 * The structured lane's approval detail is the tool input, stringified by the
 * host (Orca 1.4.205: `detail: JSON.stringify(input)` through a 16 KiB head).
 * Only a detail that parses whole as a JSON object is read this way: a
 * clipped one (Orca's truncation marker breaks the JSON) or the TUI's prose
 * keeps the text it always had.
 */

export const RAW_ARGS_FOLDED_COUNT = 6
export const RAW_ARGS_FOLDED_VALUE_CHARS = 150
export const RAW_ARGS_MAX_COUNT = 50

export type PermissionRawArg = {
  name: string
  /** The value whole, as text: a string as written, anything else as JSON. */
  value: string
  /** The value as the folded card shows it: one line, cut with a "…". */
  folded: string
}

export type PermissionRawArgs = {
  args: PermissionRawArg[]
  /** Arguments past RAW_ARGS_MAX_COUNT, never listed. */
  unlisted: number
}

export function permissionRawArgs(detail: string | undefined): PermissionRawArgs | null {
  const trimmed = detail?.trim() ?? ''
  if (!trimmed.startsWith('{')) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const entries = Object.entries(parsed as Record<string, unknown>)
  if (entries.length === 0) {
    return null
  }
  const args = entries.slice(0, RAW_ARGS_MAX_COUNT).map(([name, raw]) => {
    const value = typeof raw === 'string' ? raw : (JSON.stringify(raw) ?? String(raw))
    const line = value.replace(/\s+/g, ' ').trim()
    const chars = Array.from(line)
    const folded =
      chars.length > RAW_ARGS_FOLDED_VALUE_CHARS ? `${chars.slice(0, RAW_ARGS_FOLDED_VALUE_CHARS).join('')}…` : line
    return { name, value, folded }
  })
  return { args, unlisted: entries.length - args.length }
}

/** Whether the folded card hides anything, which is when the toggle shows. */
export function rawArgsFoldHides(raw: PermissionRawArgs): boolean {
  return (
    raw.args.length > RAW_ARGS_FOLDED_COUNT || raw.args.some((arg) => arg.folded !== arg.value)
  )
}

/** "+ 2 more arguments", for what the folded card leaves out. */
export function rawArgsOverflowLabel(hidden: number): string {
  return hidden === 1 ? '+ 1 more argument' : `+ ${hidden} more arguments`
}
