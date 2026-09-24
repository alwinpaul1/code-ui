import { describe, expect, it } from 'vitest'
import { isClaudeApiErrorText } from './claude-api-error-text'
import { SAFEGUARDS_API_ERROR_TEXT } from './fixtures/claude-turn-end-2.1.281'

// Claude Code 2.1.281 builds every API-error record from one constant,
// `ua = "API Error"`, in the shapes below (read out of its binary 2026-09-24).
// The phone sees only the text: Orca's reader drops `isApiErrorMessage`.
describe('what reads as a Claude Code API error', () => {
  it.each([
    ['a safeguards refusal, which has no status code', SAFEGUARDS_API_ERROR_TEXT],
    ['an expired login', 'Please run /login · API Error: 401 OAuth access token has expired. Re-authenticate to continue.'],
    ['a server failure', 'API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.'],
    ['a model the account cannot use', 'API Error (claude-opus-5-5): model not found. Run /model to pick a different model.'],
    ['a failed sign-in', 'Failed to authenticate. API Error: 401 Invalid bearer token'],
    ['a lost connection', 'API Error: Connection to the API was lost (ECONNRESET). This is usually temporary — try again.'],
    ['the bare constant', 'API Error']
  ])('%s', (_label, text) => {
    expect(isClaudeApiErrorText(text)).toBe(true)
  })

  it.each([
    ['prose that mentions one mid-sentence', 'The API Error: 500 you saw came from the proxy.'],
    ['one below the first line', 'Here is what happened.\n\nAPI Error: 500 Internal server error'],
    ['a word that only starts the same', 'API Errors are retried twice before the turn fails.'],
    ['nothing', '']
  ])('not %s', (_label, text) => {
    expect(isClaudeApiErrorText(text)).toBe(false)
  })
})
