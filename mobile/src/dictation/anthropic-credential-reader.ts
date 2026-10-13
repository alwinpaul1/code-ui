import {
  watchThrowawayTerminal,
  type ThrowawayTerminalClient
} from '../host-controls/throwaway-terminal'
import {
  readCredential as readPhoneCredential,
  refreshAccessToken
} from './anthropic-auth-store'

export type AnthropicCredential = {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

/** Token must have at least this much life left. */
const TOKEN_MARGIN_MS = 60_000

const CREDENTIAL_TIMEOUT_MS = 15_000

/**
 * Markers that appear ONLY on their own output line. The command uses
 * `printf` so the marker is not part of the shell's command echo — it
 * only appears once the printf executes. To defeat an interactive shell
 * that echoes the command, the parser skips every line that contains
 * the printf keyword.
 */
const BEGIN_MARKER = 'ANTHCRED_BEGIN'
const END_MARKER = 'ANTHCRED_END'

/**
 * Shell command per platform. Each prints a begin marker, the raw credential
 * JSON, and an end marker. The phone parses the JSON between the markers.
 */
function buildCommand(platform: 'mac' | 'linux' | 'windows'): string {
  const begin = `printf '${BEGIN_MARKER}\\n'`
  const end = `printf '\\n${END_MARKER}\\n'`
  if (platform === 'mac') {
    const primary =
      'security find-generic-password -s "Claude Code-credentials" -a "$(whoami)" -w 2>/dev/null'
    const fallback =
      'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null'
    return `${begin}; ${primary} || ${fallback}; ${end}`
  }
  if (platform === 'linux') {
    const file = 'cat ~/.claude/.credentials.json 2>/dev/null'
    const secret =
      'secret-tool lookup service "Claude Code-credentials" 2>/dev/null'
    return `${begin}; ${file} || ${secret}; ${end}`
  }
  return [
    `Write-Output '${BEGIN_MARKER}'`,
    'Get-Content "$env:USERPROFILE\\.claude\\.credentials.json" 2>$null',
    `Write-Output '${END_MARKER}'`
  ].join('; ')
}

/**
 * Review fix #6: skip lines that look like the echoed command (they contain
 * `printf` next to the marker text). Only match lines where the marker
 * stands alone — the actual output of `printf 'ANTHCRED_BEGIN\n'` is just
 * `ANTHCRED_BEGIN` with no surrounding `printf` or quote characters.
 */
function isMarkerLine(line: string, marker: string): boolean {
  if (!line.includes(marker)) {
    return false
  }
  // Reject lines that are part of the command echo: they contain
  // `printf` or quote characters around the marker.
  if (line.includes('printf') || line.includes("'")) {
    return false
  }
  return true
}

/**
 * Extract the Anthropic OAuth credential from terminal screen lines.
 *
 * The JSON is one line from the keychain, but terminal wrapping splits it
 * across screen rows. Joining the rows between the markers reconstructs it.
 */
function parseCredentialFromLines(
  lines: string[]
): AnthropicCredential | null {
  const beginIdx = lines.findIndex((l) => isMarkerLine(l, BEGIN_MARKER))
  const endIdx = lines.findIndex(
    (l, i) => i > beginIdx && isMarkerLine(l, END_MARKER)
  )
  if (beginIdx < 0 || endIdx < 0 || endIdx <= beginIdx) {
    return null
  }
  const payload = lines.slice(beginIdx + 1, endIdx).join('')
  const jsonStart = payload.indexOf('{')
  const jsonEnd = payload.lastIndexOf('}')
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return null
  }
  try {
    const data = JSON.parse(payload.slice(jsonStart, jsonEnd + 1))
    const oauth = data?.claudeAiOauth
    if (typeof oauth?.accessToken !== 'string' || !oauth.accessToken) {
      return null
    }
    return {
      accessToken: oauth.accessToken,
      refreshToken:
        typeof oauth.refreshToken === 'string' ? oauth.refreshToken : '',
      expiresAt:
        typeof oauth.expiresAt === 'number' ? oauth.expiresAt : 0
    }
  } catch {
    return null
  }
}

/**
 * Read Claude Code's Anthropic OAuth credential from the paired desktop.
 */
export async function fetchAnthropicCredentialFromDesktop(
  client: ThrowawayTerminalClient,
  worktreeId: string,
  platform: 'mac' | 'linux' | 'windows' = 'mac'
): Promise<AnthropicCredential | null> {
  const command = buildCommand(platform)
  const outcome = await watchThrowawayTerminal({
    client,
    worktreeId,
    command,
    timeoutMs: CREDENTIAL_TIMEOUT_MS,
    secret: true,
    read: parseCredentialFromLines
  })
  if (!outcome.ok) {
    return null
  }
  return outcome.answer
}

/**
 * Phone-first credential reader.
 *
 * 1. Check the phone's secure store (instant, no desktop needed).
 * 2. If the token is near expiry, try to refresh it.
 *    Review fix: on refresh failure, keep the original token if it still
 *    has any life left — a short dictation can finish before it expires.
 * 3. Fall back to the desktop keychain via a throwaway terminal.
 */
export async function fetchAnthropicCredential(
  client: ThrowawayTerminalClient | null,
  worktreeId: string,
  platform: 'mac' | 'linux' | 'windows' = 'mac'
): Promise<AnthropicCredential | null> {
  const phoneCred = await readPhoneCredential()
  if (phoneCred && phoneCred.accessToken) {
    if (phoneCred.expiresAt - Date.now() >= TOKEN_MARGIN_MS) {
      return phoneCred
    }
    // Token near expiry. Try to refresh.
    try {
      return await refreshAccessToken(phoneCred)
    } catch {
      // Review fix: keep the original token if it has ANY life left. A
      // dictation is typically under 30 s, so even a few minutes suffice.
      if (phoneCred.expiresAt > Date.now()) {
        return phoneCred
      }
    }
  }
  // Fall back to desktop keychain.
  if (!client) {
    return null
  }
  return fetchAnthropicCredentialFromDesktop(client, worktreeId, platform)
}
