import type { NativeChatToolPair } from '../../../../src/shared/native-chat-tool-fold'

// A SendMessage tool_use and its tool_result as Claude Code 2.1.281 wrote them
// to a session transcript (a teammate reporting to its lead, toolu_bdrk_019NP7dD…).
// Nothing is edited except `message`, whose long middle is cut with an ellipsis.
// The input carries the six keys the phone's detail sheet listed in the
// 0.9.150 screenshot (content, message, recipient, summary, to, type), with
// `content` already cut by Claude Code itself. The result is the tool's own
// JSON string, which the Claude app draws as it is.
export const SEND_MESSAGE_CLAUDE_CODE_2_1_281: NativeChatToolPair = {
  call: {
    type: 'tool-call',
    name: 'SendMessage',
    input: {
      to: 'team-lead',
      summary: 'Early finding: native Back ordering regression',
      message:
        'Early finding (review still running): native Back with a session sheet open can now leave ' +
        'the session instead of closing the sheet.\n\nmounted-bottom-drawer.tsx:214 (7c899d54). RN\'s ' +
        'BackHandler dispatches LIFO. The fork\'s view switch (use-mobile-session-view-switch.ts:82) ' +
        're-registers whenever its deps change (switchTabView follows sessionTabs, so every tab ' +
        'snapshot), and it always returns true. Before the port, the drawer re-registered on every ' +
        '`dismiss` change…\n\nTest that would go red: mock BackHandler as LIFO and render ' +
        'useMobileSessionViewSwitch\'s owner with a MountedBottomDrawer child.',
      type: 'message',
      recipient: 'team-lead',
      content: 'Early finding (review still running): native Back…'
    }
  },
  result: {
    type: 'tool-result',
    output:
      '{"success":true,"message":"Message sent to team-lead\'s inbox","msg_id":' +
      '"fc67f2cf-2ae5-42b0-b4b0-f5db72dde00d","routing":{"sender":"port-reviewer","senderColor":"blue",' +
      '"target":"@team-lead","summary":"Early finding: native Back ordering regression","content":' +
      '"Early finding (review still running): native Back…"}}'
  }
}
