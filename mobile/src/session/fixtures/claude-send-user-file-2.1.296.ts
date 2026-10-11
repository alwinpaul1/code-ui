import type { NativeChatMessage } from '../../../../src/shared/native-chat-types'

// ─── A picture the agent read, then sent to the user ─────────────────────────
//
// Claude Code 2.1.296, session 0954729d on this machine, 2026-10-11, the turn
// after "can you show where are the other logos". Record ids, timestamps,
// tool ids, paths and the caption are the records' own; the two Bash calls'
// commands and outputs are cut down to what the turn needs.
//
// What the transcript holds:
//   - the Read result (c8849b9b) is a `tool_result` whose content is one
//     `image` block, `source.type: "base64"`, `image/png`, 162,568 base64
//     characters (a 2010×440 sheet);
//   - SendUserFile (b1ffd0af) carries `files: [<path>]`, `caption`,
//     `status: "normal"`, `display: "render"`. Its result (518dd6ab) is TEXT,
//     "1 file delivered to user. <path> → file_uuid: f18bfab5-…", and its
//     `toolUseResult.attachments[0]` names the path, size 78,100, `isImage`,
//     `image/png` and the `file_uuid`. No bytes: the Claude app gets the
//     picture by that file_uuid from Anthropic's servers, which the phone
//     cannot reach.
//
// What Orca 1.4.224's transcript reader hands the phone (its bundle, read
// 2026-10-11): a tool result flattened to its text, so the Read result is
// `output: ""`; an `image` block is kept only when its source is a URL, so the
// base64 never arrives; and SendUserFile is an ordinary call and result.

export const SEND_FILE_PATH =
  '/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/0954729d-6205-4368-8185-7c630268f2d0/scratchpad/logo/where.png'
export const SEND_FILE_CAPTION = 'Every Code UI logo today, each shown where it appears'
export const READ_CALL_ID = '4082c312-fbfa-41fe-863d-a9a5988993ca'
export const SEND_CALL_ID = 'b1ffd0af-446b-4695-95bf-c8ef8ea1dca0'
export const REPLY_TEXT =
  "I've sent you a picture of every logo the app uses today, each shown where it appears:"

type Block = NativeChatMessage['blocks'][number]
const row = (id: string, role: NativeChatMessage['role'], at: string, blocks: Block[]): NativeChatMessage => ({
  id,
  role,
  timestamp: Date.parse(at),
  source: 'transcript',
  blocks
})

export const SEND_FILE_TURN: NativeChatMessage[] = [
  row('121ce01c-6ee8-4fed-9579-70f0e65ed479', 'user', '2026-10-11T14:27:57.058Z', [
    { type: 'text', text: 'can you show where are the other logos' }
  ]),
  row('790c0712-a09f-4359-9754-562f9f77ac86', 'assistant', '2026-10-11T14:28:02.405Z', [
    {
      type: 'tool-call',
      name: 'Bash',
      input: { command: 'grep -rln "<AppLogo" src app | grep -v test', description: 'Find every place the logo is used' },
      callId: 'toolu_01FmJBRH6FMki4Y5zksBU9KL'
    }
  ]),
  row('adeaea10-2917-4cb8-ba68-dbb639f89da8', 'tool', '2026-10-11T14:28:03.144Z', [
    { type: 'tool-result', output: 'src/home/MobileHomeEmptyState.tsx\nsrc/home/MobileHomeTopBar.tsx' }
  ]),
  row('aa4b774c-acf4-42af-a0e3-acda0aca3691', 'assistant', '2026-10-11T14:28:17.115Z', [
    {
      type: 'tool-call',
      name: 'Bash',
      input: { command: 'python3 - <<EOF … EOF', description: 'Draw every current logo in the place it appears' },
      callId: 'toolu_01Q1UGWTYneqa9anLsFoGgVs'
    }
  ]),
  row('8f878b8d-c802-4dd0-9aa8-6a9ceeae013b', 'tool', '2026-10-11T14:28:17.893Z', [
    { type: 'tool-result', output: 'ok' }
  ]),
  row(READ_CALL_ID, 'assistant', '2026-10-11T14:28:20.760Z', [
    { type: 'tool-call', name: 'Read', input: { file_path: SEND_FILE_PATH }, callId: 'toolu_011RcaKYAbsTxr6dxvbxAjKz' }
  ]),
  row('c8849b9b-271e-4c06-af4a-dc80ed991a52', 'tool', '2026-10-11T14:28:21.010Z', [{ type: 'tool-result', output: '' }]),
  row(SEND_CALL_ID, 'assistant', '2026-10-11T14:28:25.190Z', [
    {
      type: 'tool-call',
      name: 'SendUserFile',
      input: { files: [SEND_FILE_PATH], caption: SEND_FILE_CAPTION, status: 'normal', display: 'render' },
      callId: 'toolu_01Xfy5TufAwWWHuBb27AWLKo'
    }
  ]),
  row('518dd6ab-af77-4194-8648-af6caabfce35', 'tool', '2026-10-11T14:28:26.126Z', [
    {
      type: 'tool-result',
      output: `1 file delivered to user.\n  ${SEND_FILE_PATH} → file_uuid: f18bfab5-adbe-4433-a37d-e652bced459b`
    }
  ]),
  row('6197b2c5-cc14-42c7-809e-adcbc21d0af6', 'assistant', '2026-10-11T14:28:33.544Z', [
    { type: 'text', text: REPLY_TEXT }
  ])
]
