// Codex 0.153.4 in code mode, rollout of 2026-09-06: one `sleep 90`, started by
// an `exec` cell that calls tools.exec_command and then polled by `exec` cells
// that call tools.write_stdin with empty chars. Orca's Codex decoder
// (src/main/native-chat/transcript-line-decoders-codex.ts) hands a
// custom_tool_call to the phone as a tool-call named `exec` whose input is the
// cell's source text, verbatim.
export const CODE_MODE_START =
  'text(await tools.exec_command({cmd:"sleep 90",yield_time_ms:1000,max_output_tokens:100}));\n'

export const CODE_MODE_POLL = (yieldMs: number): string =>
  `text(await tools.write_stdin({session_id:68964,chars:"",yield_time_ms:${yieldMs},max_output_tokens:100}));\n`
