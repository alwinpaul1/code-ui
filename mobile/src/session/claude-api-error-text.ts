/**
 * Whether a transcript text is one of Claude Code's API-error records.
 *
 * Claude Code writes an API failure as an assistant record with
 * `isApiErrorMessage: true`, but Orca's transcript reader drops that flag, so
 * the phone has only the words. Claude Code 2.1.281 builds every such record
 * from one constant, "API Error", as `API Error: …`, `API Error (<model>): …`,
 * `<hint> · API Error: …`, `Failed to authenticate. API Error: …` or the bare
 * constant (read out of its binary, 2026-09-24). A safeguards refusal is one
 * of them and has no status code ("API Error: Opus 5.5 (1M context)'s
 * safeguards flagged this message …", session 967668df), so a code is not
 * part of the shape. Only the first line is read: that is where Claude Code
 * puts the prefix, and an error quoted further down is the agent talking.
 */
export function isClaudeApiErrorText(text: string): boolean {
  return API_ERROR_FIRST_LINE.test(text.split('\n', 1)[0] ?? '')
}

const API_ERROR_FIRST_LINE = /^(?:.*·\s*|Failed to authenticate\.\s+)?API Error(?:$|:|\s\()/
