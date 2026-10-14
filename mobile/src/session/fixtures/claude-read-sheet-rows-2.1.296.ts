import type { NativeChatMessage } from '../../../../src/shared/native-chat-types'

// ─── Two pictures Claude Code read, as the phone receives them ───────────────
//
// Claude Code 2.1.296, session 211c47c2 on this machine, 2026-10-14 08:48Z:
// the run the user screenshotted ("Ran 2 commands, read 2 files", then two
// chips, `sheet.png` and `rows.png`, where the Claude app draws the
// pictures). Uuids, tool ids, times and paths are the records' own, except
// the lead text and the second Read's result row, which are stand-ins.
//
// Each Read's result in the transcript is one `image` item, base64 PNG.
// Orca 1.4.224's reader keeps an image only when its source is a URL, and
// flattens a tool result to the text of its items, so the phone receives the
// call with its `file_path` and a result with `output: ""`. The Bash commands
// are shortened; their output is the record's own.

const SCRATCH = '/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/211c47c2-7a42-4c86-9a59-eaa0905d39e6/scratchpad/vid2'
export const SHEET_PATH = `${SCRATCH}/sheet.png`
export const ROWS_PATH = `${SCRATCH}/rows.png`
export const SHEET_READ_ID = '9b2de0fe-aab7-4a1f-bb09-b4fd39ecb0fc'
export const ROWS_READ_ID = '59efcc35-383f-4064-9732-854c8d99b84b'

const at = (clock: string) => Date.parse(`2026-10-14T${clock}Z`)

export const SHEET_RUN: NativeChatMessage[] = [
  {
    id: '51bfb652-a51a-4e87-beca-751abced5098',
    role: 'assistant',
    timestamp: at('08:48:44.238'),
    source: 'transcript',
    blocks: [{ type: 'tool-call', name: 'Bash', input: { command: `S=${SCRATCH}; mkdir -p $S && cp … $S/rec.mp4` }, callId: 'toolu_01UwghiS8zHtzpUQrVziJ3mR' } as NativeChatMessage['blocks'][number]]
  },
  {
    id: SHEET_READ_ID,
    role: 'assistant',
    timestamp: at('08:48:45.504'),
    source: 'transcript',
    blocks: [{ type: 'tool-call', name: 'Read', input: { file_path: SHEET_PATH }, callId: 'toolu_01NWcQHgsfhiNojhcUGLKBnY' } as NativeChatMessage['blocks'][number]]
  },
  {
    id: '003a04d4-1eca-4269-83ac-3508324abede',
    role: 'tool',
    timestamp: at('08:48:46.426'),
    source: 'transcript',
    blocks: [{ type: 'tool-result', output: '1080,2316\n9.845211' }]
  },
  {
    id: '7ca08ac4-a459-4949-92b5-ecc4665a4dbb',
    role: 'tool',
    timestamp: at('08:48:46.563'),
    source: 'transcript',
    blocks: [{ type: 'tool-result', output: '' }]
  }
]

export const ROWS_RUN: NativeChatMessage[] = [
  {
    id: '41bbd739-ba07-405e-8959-e2cc5849099e',
    role: 'assistant',
    timestamp: at('08:48:53.995'),
    source: 'transcript',
    blocks: [{ type: 'tool-call', name: 'Bash', input: { command: `S=${SCRATCH}; ffmpeg … $S/rows.png` }, callId: 'toolu_01AbXhGcLoUKJFELa45vpiC8' } as NativeChatMessage['blocks'][number]]
  },
  {
    id: ROWS_READ_ID,
    role: 'assistant',
    timestamp: at('08:48:55.165'),
    source: 'transcript',
    blocks: [{ type: 'tool-call', name: 'Read', input: { file_path: ROWS_PATH }, callId: 'toolu_01WUPsnDDwmrKKqCBj9eqMzh' } as NativeChatMessage['blocks'][number]]
  },
  {
    id: '1032d9f3-24d5-447c-98f2-ba93e6c6d4ad',
    role: 'tool',
    timestamp: at('08:48:55.437'),
    source: 'transcript',
    blocks: [{ type: 'tool-result', output: '(Bash completed with no output)' }]
  },
  {
    id: 'rows-read-result',
    role: 'tool',
    timestamp: at('08:48:55.600'),
    source: 'transcript',
    blocks: [{ type: 'tool-result', output: '' }]
  }
]

/** The text the turn opened with, before the first run. */
export const LEAD: NativeChatMessage = {
  id: 'lead-text',
  role: 'assistant',
  timestamp: at('08:48:40.000'),
  source: 'transcript',
  blocks: [{ type: 'text', text: 'Pulling frames out of the recording:' }]
}

/** The text the agent wrote after the first run (record f76aeaa5). */
export const BETWEEN: NativeChatMessage = {
  id: 'f76aeaa5-eca6-4323-9e4e-f75c28ffb366',
  role: 'assistant',
  timestamp: at('08:48:52.016'),
  source: 'transcript',
  blocks: [{ type: 'text', text: "That's the Claude app's recording mode. Looking closer at the recording row and its waveform:" }]
}
