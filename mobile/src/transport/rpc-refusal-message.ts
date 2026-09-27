/**
 * A refused operation's message, or the screen's own copy when the host sent none. Only the
 * refusal catch may call this: a transport rejection's message is surfaced verbatim, empty included.
 * The exception is a catch this fork added where main had none (the diff review's Send Notes, Stage
 * Reviewed Files, Open in Session and marking notes sent): with no main behaviour to keep, an empty
 * transport message falls back to the screen's copy there, since an empty banner draws nothing.
 */
export function refusedRpcMessageOrFallback(error: unknown, fallback: string): string {
  return (error instanceof Error ? error.message : '') || fallback
}

/**
 * A reply interpreted, or the host's own refusal message as a plain Error when it refused — the
 * screen's copy when it sent none. The caller awaits the request and passes only the interpretation
 * as a thunk, so a transport rejection stays outside the catch and reaches the caller as the object
 * the transport threw, delivery-unknown mark intact.
 */
export function interpretOrThrowRefusalMessage<T>(interpret: () => T, fallback: string): T {
  try {
    return interpret()
  } catch (error) {
    throw new Error(refusedRpcMessageOrFallback(error, fallback))
  }
}

/**
 * An error a host reported inside an accepted reply, or the screen's copy when it sent none.
 *
 * The host contract declares `error` as a string, so a non-string is a malformed reply and reads
 * as absent — every consumer is display or prompt text, and main's pass-through made
 * `summarizeCommitFailure` throw on `.slice`.
 */
export function hostReplyErrorTextOrFallback(value: unknown, fallback: string): string {
  return (typeof value === 'string' ? value : '') || fallback
}
