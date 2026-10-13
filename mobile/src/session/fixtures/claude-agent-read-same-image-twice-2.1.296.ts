import type { NativeChatMessage } from '../../../../src/shared/native-chat-types'

// ─── The same picture read twice in one run ─────────────────────────────────
//
// Claude Code 2.1.296, session 3dec2e94 (a NexOS Mobile worktree on this
// machine), 2026-10-13 12:29:39Z to 12:30:06Z. The user's report of that day:
// under "Ran 3 commands, read 2 files" the phone drew two "chips.png"
// placeholders, touching, and neither showed the picture.
//
// The strings are the records' own (ids are the records' `uuid`s, the call ids
// their `tool_use` ids). The agent read its screenshot, took a new one with the
// same name, and read the path again. Both Reads name one scratchpad file under
// /private/tmp, outside every workspace, and no assistant text in the session
// names it (the turn's words after the run do not), so the desktop shares it
// on neither of Orca's rules (use-host-image-previews.ts, `notShared`).
//
// As the phone receives them from Orca's reader: each Read result's `image`
// item is dropped, so its output is empty.

export const CHIPS_PATH =
  '/private/tmp/claude-501/-Users-alwinpaul-Desktop-NexOS-Mobile-wt-work-2026-10-05/3dec2e94-c429-4c34-af89-68c601b2d4ec/scratchpad/chk/chips.png'

const at = (iso: string) => Date.parse(iso)
const call = (id: string, iso: string, callId: string, name: string, input: Record<string, unknown>): NativeChatMessage => ({
  id,
  role: 'assistant',
  timestamp: at(iso),
  source: 'transcript',
  blocks: [{ type: 'tool-call', name, input, callId } as NativeChatMessage['blocks'][number]]
})
const result = (id: string, iso: string, callId: string, output: string): NativeChatMessage => ({
  id,
  role: 'tool',
  timestamp: at(iso),
  source: 'transcript',
  blocks: [{ type: 'tool-result', output, callId } as NativeChatMessage['blocks'][number]]
})

/** The turn's words before the run (record 1a375d3c), first sentence. */
export const CHIPS_BEFORE: NativeChatMessage = {
  id: '1a375d3c-2136-43bd-9bf5-23a69cb7b124',
  role: 'assistant',
  timestamp: at('2026-10-13T12:26:52.222Z'),
  source: 'transcript',
  blocks: [{ type: 'text', text: "The wording change is pushed to PR #12 (`5c194b26`), but it isn't on the tablet yet." }]
}

export const FIRST_CHIPS_READ_ID = '588f9099-6f89-4341-9a3f-d3ae3f372014'
export const SECOND_CHIPS_READ_ID = '5421dd68-42d9-4707-8a8c-888263859e1f'

/** "Ran 3 commands, read 2 files": three Bash calls and two Reads of one path. */
export const CHIPS_RUN: NativeChatMessage[] = [
  call('5a551a7d-5e78-407c-a6e1-da2a96ab89a0', '2026-10-13T12:29:39.338Z', 'toolu_01VqE66Xhq1qzPGTezUf8yEs', 'Bash', {
    command:
      'cat /private/tmp/claude-501/-Users-alwinpaul-Desktop-NexOS-Mobile-wt-work-2026-10-05/3dec2e94-c429-4c34-af89-68c601b2d4ec/tasks/b2mynbidy.output',
    description: "Read the install job's result"
  }),
  result(
    '490d5fda-e1db-4614-8afa-be7bdc368843',
    '2026-10-13T12:29:39.974Z',
    'toolu_01VqE66Xhq1qzPGTezUf8yEs',
    'device 192.168.1.142:33261\n    lastUpdateTime=2026-10-13 14:29:18\nINSTALLED\n\n[exited with code 0]'
  ),
  call(FIRST_CHIPS_READ_ID, '2026-10-13T12:29:42.690Z', 'toolu_01H6qufoVPs1LB3CHqZQuavF', 'Read', { file_path: CHIPS_PATH }),
  result('c7b21663-5587-40da-bbc4-f69d8e7908d7', '2026-10-13T12:29:42.888Z', 'toolu_01H6qufoVPs1LB3CHqZQuavF', ''),
  call('d4caeae3-a94e-4427-9851-01d897a06ae4', '2026-10-13T12:29:46.264Z', 'toolu_01Bss3aczRzK3Xhcrfn6gwmR', 'Bash', {
    command:
      'export ANDROID_SERIAL=192.168.1.142:33261; adb shell dumpsys power | grep -E "mWakefulness=|Display Power" | head -3; adb shell pidof com.nexdash.driver; adb shell dumpsys activity activities | grep -m1 -E "topResumedActivity|mResumedActivity"',
    description: 'Check if the screen is off or the app is black'
  }),
  result(
    '463491ee-e25d-426c-be97-0d1a47671ec2',
    '2026-10-13T12:29:47.227Z',
    'toolu_01Bss3aczRzK3Xhcrfn6gwmR',
    '  mWakefulness=Dozing\nDisplay Power: com.android.server.power.PowerManagerService$3@699e6aa\n23459'
  ),
  call('6447becb-43b9-46dc-966e-24ff7fe33997', '2026-10-13T12:29:52.701Z', 'toolu_01BUfFWfMJ3S4kUs9RLrTFGk', 'Bash', {
    command:
      'export ANDROID_SERIAL=192.168.1.142:33261; S=/private/tmp/claude-501/-Users-alwinpaul-Desktop-NexOS-Mobile-wt-work-2026-10-05/3dec2e94-c429-4c34-af89-68c601b2d4ec/scratchpad/chk; adb shell input keyevent KEYCODE_WAKEUP; sleep 2; adb shell dumpsys window | grep -m1 -E "mDreamingLockscreen|isKeyguardShowing|mShowingLockscreen"; adb shell monkey -p com.nexdash.driver -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 4; adb exec-out screencap -p > $S/chip.png && sips -Z 1400 $S/chip.png --out $S/chips.png >/dev/null',
    description: 'Wake the screen, bring the app forward, screenshot'
  }),
  result(
    '63f5421e-fd20-479b-8cb8-b2d49289f468',
    '2026-10-13T12:30:00.609Z',
    'toolu_01BUfFWfMJ3S4kUs9RLrTFGk',
    '    mShowingDream=false mDreamingLockscreen=true'
  ),
  call(SECOND_CHIPS_READ_ID, '2026-10-13T12:30:03.324Z', 'toolu_01LvCB3gtyfachPztRwwxncj', 'Read', { file_path: CHIPS_PATH }),
  result('c34fc3b2-0fd3-42d2-9a4c-dbf7fdd30aef', '2026-10-13T12:30:03.507Z', 'toolu_01LvCB3gtyfachPztRwwxncj', '')
]

/** The turn's words after the run (record 73d3022c), first two sentences:
 *  they never name the picture's path. */
export const CHIPS_AFTER: NativeChatMessage = {
  id: '73d3022c-a819-43f1-93d4-753b48a3ead2',
  role: 'assistant',
  timestamp: at('2026-10-13T12:30:06.659Z'),
  source: 'transcript',
  blocks: [
    {
      type: 'text',
      text: 'The new build is on the tablet (installed 14:29, with the "No truck assigned" wording), and the app is running. I couldn\'t screenshot it because the tablet is locked.'
    }
  ]
}
