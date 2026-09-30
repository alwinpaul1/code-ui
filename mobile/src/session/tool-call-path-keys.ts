// The input fields a tool call names its one file in: Claude Code's
// `file_path` (Read, Edit, Write), `notebook_path` (NotebookEdit, and the older
// NotebookRead), and the `path` / `filePath` other tools use. One list for
// every reader, so they cannot drift: the created-file count read
// `notebook_path` while the run sentence did not, and two NotebookEdits of one
// notebook read "Edited 2 files" (review, 2026-09-30).

export const TOOL_CALL_PATH_KEYS = ['file_path', 'notebook_path', 'path', 'filePath'] as const

/** The first of TOOL_CALL_PATH_KEYS that holds a string with more than
 *  whitespace in it; null when none does. */
export function toolCallPath(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) {
    return null
  }
  const record = input as Record<string, unknown>
  for (const key of TOOL_CALL_PATH_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }
  return null
}
