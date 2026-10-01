// ─── Claude Code's input box and its review notice, 2.1.287 ──────────────────
//
// Reported 2026-10-01 (Claude Code 2.1.287): a 176-character single-line message
// sent from the chat reached the desktop input as the message, 33 newlines and
// the message again. Claude stripped the 66 control bytes in it and, having
// removed something, did not submit: it drew the notice below and waited.
//
// PROVENANCE. Mixed.
//   TRANSCRIBED from Orca's terminal-history log of that session (the rows as
//   painted, with the cursor moves resolved into rows; the words replaced by
//   stand-ins of the same shape, because this repo is public):
//     - the rule rows: a plain run of "─" across the whole width (190 columns);
//     - the input row: "❯" and a NO-BREAK SPACE, then the text; wrapped text on
//       rows indented two columns; blank rows absent because Orca drops them;
//     - the notice: "Removed 67 invisible characters · review and press Enter to
//       send" on the row directly above the top rule, painted at column 129, so a
//       screen read gives it 128 spaces first (the log's `ESC[128C`);
//     - after the failed submit the input row is a BARE "❯" with the text on rows
//       under it (the stripped newlines put blank rows between, which Orca drops).
//   FROM THE 2.1.287 BINARY (`strings`, read, never run): the notice is built by
//   `txe(count, "review", key)` as `${n} invisible characters · review and press
//   ${key} to send` (one character: "Removed 1 invisible character"), and the
//   key name is a parameter; the input tokenizer reads a control byte as a key
//   only when the whole read is under 64 bytes (`a.length<64||u===WZ.BS`).
//   MODELLED, not captured: the conversation rows above the notice, the status
//   rows under the box, and Orca's `draft` field for a composer its detector
//   accepts (the text moves out of `tail`, a bare "❯" stays) - the shape comes
//   from the 2.1.263 capture in docs/mobile-queue-controls.md and the 2.1.285
//   named-rule fixture, not from this session.

const RULE = '─'.repeat(190)

/** 176 characters, one line; stand-ins for the user's command. */
export const INCIDENT_MESSAGE =
  '! sudo toolx -a com.example/anchorname-v6 -F all; sudo toolx -X 1111111111111111111; sudo toolx -X 22222222222222222222; sudo route -n delete -inet6 default -interface utunNNNN'

export const REVIEW_NOTICE = 'Removed 67 invisible characters · review and press Enter to send'

const BELOW = ['  [Opus 5.5 xhigh | Max 20x] ██░░░░░░░░ 16% (162k/1.0M) | Project git:(main)', '  ⏵⏵ auto mode on (shift+tab to cycle)']
const ABOVE = ['⏺ The firewall rule did not help.', '✻ Sautéed for 1m 31s · done 9:40 PM']

/** The input holding text, Orca's composer detector having declined (a named
 *  rule): the text is in the rows, `draft` is ''. */
export function composerWithTextInRows(text: string, columns = 190): string[] {
  const width = columns - 2
  const chunks = text.match(new RegExp(`.{1,${width}}`, 'gs')) ?? ['']
  return [
    ...ABOVE,
    RULE,
    ...chunks.map((chunk, index) => (index === 0 ? `❯ ${chunk}` : `  ${chunk}`)),
    RULE,
    ...BELOW
  ]
}

/** The input holding text, Orca's detector having accepted it: a bare "❯" and
 *  the text published as `draft`. */
export function composerWithTextInDraft(): string[] {
  return [...ABOVE, RULE, '❯', RULE, ...BELOW]
}

/** An empty input. */
export const EMPTY_COMPOSER: string[] = [...ABOVE, RULE, '❯ ', RULE, ...BELOW]

/** After the failed submit: the notice over a bare "❯" with the stripped text
 *  on rows under it. Transcribed shape (log offset 1313866). */
export const AFTER_REVIEW_NOTICE: string[] = [
  ...ABOVE,
  `${' '.repeat(128)}${REVIEW_NOTICE}`,
  RULE,
  '❯ ',
  `  ${INCIDENT_MESSAGE}`,
  RULE,
  ...BELOW
]
