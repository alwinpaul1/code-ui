// Serializes composed native-chat write sequences (clear/paste/settle/submit,
// paced answer keystrokes) per HOST terminal. Two concurrent sequences into one
// PTY interleave their bytes; a second sender must be rejected up front, not
// woven in. Module scope for the same reason as the stale-input marker: the
// terminal outlives any one screen, and independent hooks share the same PTY.
const writeInFlightTerminals = new Set<string>()
// Who holds each terminal's lock, so a holder that lets go early (a send that has
// written its body and now only reads) cannot later release a lock someone else
// has since taken.
const writeOwners = new Map<string, symbol>()

/** Claim the terminal for one composed write sequence. False = another
 *  sequence is mid-flight; the caller must reject its send. */
export function acquireMobileNativeChatTerminalWrite(terminal: string): boolean {
  if (writeInFlightTerminals.has(terminal)) {
    return false
  }
  writeInFlightTerminals.add(terminal)
  writeOwners.set(terminal, Symbol(terminal))
  return true
}

/** The current holder of the terminal's lock, or undefined when it is free. */
export function mobileNativeChatTerminalWriteOwner(terminal: string): symbol | undefined {
  return writeOwners.get(terminal)
}

// Locks taken FOR a composer send (the caller is the image hook's send, which
// then calls the text send). Only those may be let go early by the text send:
// whoever else holds a terminal's lock (a permission tap, a queue edit, an answer)
// is none of its business, even when a tab switch points the send at that terminal.
const sendOwners = new Map<string, symbol>()

/** Claim the terminal for a composer send; the holder's token, or null when
 *  another sequence has it. */
export function acquireMobileNativeChatTerminalWriteForSend(terminal: string): symbol | null {
  if (!acquireMobileNativeChatTerminalWrite(terminal)) {
    return null
  }
  const owner = writeOwners.get(terminal)!
  sendOwners.set(terminal, owner)
  return owner
}

/** Let go of the terminal's lock if it was taken for a composer send and is still
 *  that holder's. The send calls this once its body is written. */
export function releaseMobileNativeChatTerminalWriteForSend(terminal: string): void {
  const owner = sendOwners.get(terminal)
  if (owner !== undefined && writeOwners.get(terminal) === owner) {
    releaseMobileNativeChatTerminalWrite(terminal, owner)
  }
}

/** Whether a composed sequence currently owns the terminal. Lets a best-effort
 *  writer (the draft mirror) stand aside instead of interleaving bytes. */
export function isMobileNativeChatTerminalWriteInFlight(terminal: string): boolean {
  return writeInFlightTerminals.has(terminal)
}

/** Release the terminal. With `owner`, only if that holder still has it: an early
 *  release by the send leaves nothing for the holder's own `finally` to undo. */
export function releaseMobileNativeChatTerminalWrite(
  terminal: string | null | undefined,
  owner?: symbol
): void {
  if (!terminal) {
    return
  }
  if (owner !== undefined && writeOwners.get(terminal) !== owner) {
    return
  }
  writeInFlightTerminals.delete(terminal)
  writeOwners.delete(terminal)
  sendOwners.delete(terminal)
}

/** Test-only: module scope outlives a single test's hooks. */
export function resetMobileNativeChatTerminalWritesForTests(): void {
  writeInFlightTerminals.clear()
  writeOwners.clear()
  sendOwners.clear()
  burstTerminals.clear()
  halfSteppedTerminals.clear()
}

/**
 * A selector answer that was only partly written: some of its keystroke
 * groups landed (or may have — a lost ack) and the rest did not. The agent's
 * selector is then somewhere a from-scratch plan does not expect: on its open
 * "Type something" row, where the row digit would be typed as text, or with a
 * multi-select box already toggled, which the same digit would toggle back
 * OFF. The prompt itself is unchanged and the agent still 'waiting', so no
 * stale check sees it. The mark is what does.
 *
 * Shared between the chat card's hook and the notification shade's sender,
 * because each can leave a terminal half-stepped and the other cannot see its
 * state otherwise. Keyed by prompt: once the agent is asking something else
 * the selector has been redrawn, and the mark no longer applies.
 */
export type MobileNativeChatHalfStep = {
  /** `nativeChatAskDismissKey` of the prompt that was being answered. */
  promptKey: string
  /** Where it stopped, for the log line and the refusal: e.g. "write 2/3 rejected". */
  detail: string
}

const halfSteppedTerminals = new Map<string, MobileNativeChatHalfStep>()

export function markMobileNativeChatTerminalHalfStepped(
  terminal: string,
  mark: MobileNativeChatHalfStep
): void {
  halfSteppedTerminals.set(terminal, mark)
}

export function mobileNativeChatTerminalHalfStep(
  terminal: string
): MobileNativeChatHalfStep | null {
  return halfSteppedTerminals.get(terminal) ?? null
}

export function clearMobileNativeChatTerminalHalfStep(terminal: string): void {
  halfSteppedTerminals.delete(terminal)
}

/** A burst is the window in which a composed sequence is actually issuing reads
 * and writes, as opposed to holding the terminal while a user types into a
 * sheet. A background poller should stand aside for the burst only: standing
 * aside for the whole lock freezes permission detection for as long as the
 * editor is open. */
const burstTerminals = new Set<string>()

export function beginMobileNativeChatTerminalBurst(terminal: string): void {
  burstTerminals.add(terminal)
}

export function endMobileNativeChatTerminalBurst(terminal: string): void {
  burstTerminals.delete(terminal)
}

export function isMobileNativeChatTerminalBurstActive(terminal: string): boolean {
  return burstTerminals.has(terminal)
}
