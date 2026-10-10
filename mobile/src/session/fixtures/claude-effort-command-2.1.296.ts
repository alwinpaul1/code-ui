/**
 * Transcript records Claude Code writes when the effort is set by a command.
 *
 * CAPTURED: `EFFORT_HIGH_LINES` are copied verbatim from a throwaway Claude Code
 * 2.1.296 session (2026-10-11, `claude --settings <empty>` under `env -i` in a
 * private tmux server), where `/effort high` was typed at the prompt with no
 * model call. Only `cwd` was scrubbed to `/tmp/project`. The `isMeta` caveat row
 * is dropped by Orca's decoder; the envelope and the stdout row reach the phone
 * as two user rows, the stdout row's `parentUuid` naming the envelope.
 *
 * MODELLED, not captured: `modelWithEffortLines`. The words are the 2.1.296
 * binary's own template pieces (`Set model to `, ` and saved as your default for
 * new sessions`, a backticked effort level after ` with `), the same wording the
 * user quoted from his session on 2026-10-11; the record shape is the captured
 * `/effort` one with the command renamed.
 */
export const CAPTURED_SESSION_ID = '46220b40-9bc5-4304-9b27-325f74341cc7'

export const EFFORT_HIGH_LINES: readonly string[] = [
  '{"parentUuid":"00144131-1d98-41fd-9dd2-61993c69a73f","isSidechain":false,"promptId":"4c5c07e5-669a-475d-993d-ef5d9f5d6bfd","type":"user","message":{"role":"user","content":"<local-command-caveat>The command below was run directly in Claude Code, not sent to you as a request, and its output goes straight to the user. It\'s recorded here as context for later messages.</local-command-caveat>"},"isMeta":true,"uuid":"efa5de19-063d-4832-ab1d-1ea1dde2fba6","timestamp":"2026-10-10T22:04:38.332Z","userType":"external","entrypoint":"cli","cwd":"/tmp/project","sessionId":"46220b40-9bc5-4304-9b27-325f74341cc7","version":"2.1.296","gitBranch":"main"}',
  '{"parentUuid":"efa5de19-063d-4832-ab1d-1ea1dde2fba6","isSidechain":false,"promptId":"4c5c07e5-669a-475d-993d-ef5d9f5d6bfd","type":"user","message":{"role":"user","content":"<command-name>/effort</command-name>\\n            <command-message>effort</command-message>\\n            <command-args>high</command-args>"},"uuid":"ad7ffccb-d899-4b09-a3b8-2495b2ed30a1","timestamp":"2026-10-10T22:04:38.305Z","userType":"external","entrypoint":"cli","cwd":"/tmp/project","sessionId":"46220b40-9bc5-4304-9b27-325f74341cc7","version":"2.1.296","gitBranch":"main"}',
  '{"parentUuid":"ad7ffccb-d899-4b09-a3b8-2495b2ed30a1","isSidechain":false,"promptId":"4c5c07e5-669a-475d-993d-ef5d9f5d6bfd","type":"user","message":{"role":"user","content":"<local-command-stdout>Set effort level to high (saved as your default for new sessions): Comprehensive implementation with extensive testing and documentation</local-command-stdout>"},"uuid":"6eef2008-d0e3-4b85-8cfe-9a63a9307f09","timestamp":"2026-10-10T22:04:38.305Z","userType":"external","entrypoint":"cli","cwd":"/tmp/project","sessionId":"46220b40-9bc5-4304-9b27-325f74341cc7","version":"2.1.296","gitBranch":"main"}'
]

/** The captured `/effort` records with fresh ids and a new time, for a later
 *  run of the same command at another level. */
export function effortLines(level: string, at: string, tag: string): string[] {
  return EFFORT_HIGH_LINES.map((line) =>
    line
      .replace(/"timestamp":"[^"]+"/, `"timestamp":"${at}"`)
      .replace(/<command-args>high</, `<command-args>${level}<`)
      .replace(/Set effort level to high /, `Set effort level to ${level} `)
      .replace(/"(uuid|parentUuid)":"([0-9a-f]{8})/g, (_whole, key: string, head: string) => `"${key}":"${tag}${head.slice(tag.length)}`)
  )
}

/** MODELLED (see above): `/model` choosing a model and an effort. */
export function modelWithEffortLines(model: string, level: string, at: string, tag: string): string[] {
  return EFFORT_HIGH_LINES.map((line) =>
    line
      .replace(/"timestamp":"[^"]+"/, `"timestamp":"${at}"`)
      .replace('<command-name>/effort</command-name>', '<command-name>/model</command-name>')
      .replace('<command-message>effort</command-message>', '<command-message>model</command-message>')
      .replace('<command-args>high</command-args>', '<command-args></command-args>')
      .replace(
        /Set effort level to high \(saved as your default for new sessions\): [^<]+/,
        `Set model to \`${model}\` and saved as your default for new sessions with \`${level}\` effort`
      )
      .replace(/"(uuid|parentUuid)":"([0-9a-f]{8})/g, (_whole, key: string, head: string) => `"${key}":"${tag}${head.slice(tag.length)}`)
  )
}
