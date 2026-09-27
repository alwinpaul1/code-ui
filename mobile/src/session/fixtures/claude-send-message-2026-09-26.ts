import type { NativeChatToolPair } from '../../../../src/shared/native-chat-tool-fold'

// The SendMessage call behind the 2026-09-26 recording and screenshots: the
// lead messaging a teammate by agent id. Its inputs are the five the sheet
// listed (content, message, recipient, to, type), with the values the phone
// and the Claude app both drew. `content` arrives already cut ("fra..."), so
// the full text is `message`. There is no `summary`. The Claude app drew:
//   row:   "Messaged @a07ea6f616a8e32a1 Agreed. Your measurem… ›"
//   sheet: "Messaged @a07ea6f616a8e32a1", "Completed" centred under it
// where Code UI drew "Messaged an agent" for both.
export const SEND_MESSAGE_BY_ID_2026_09_26: NativeChatToolPair = {
  call: {
    type: 'tool-call',
    name: 'SendMessage',
    input: {
      content: 'Agreed. Your measurement beats my read of the fra...',
      message:
        'Agreed. Your measurement beats my read of the frames. Match the recording: the running-tasks ' +
        'star stays still, the text stays still, and nothing cycles. Remove the breathing there too. ' +
        'Use the shimmer numbers you measured (1.5 s linear sweep, triangular band ~6 chars at the ' +
        'base and ~3.4 at half depth, ~26% contrast at the centre, static icon and chevron). If the ' +
        'phone\'s "Working..." line has its own spinner, leave it as it is.',
      recipient: 'a07ea6f616a8e32a1',
      to: 'a07ea6f616a8e32a1',
      type: 'message'
    }
  },
  result: {
    type: 'tool-result',
    output:
      '{"success":true,"message":"Message queued for delivery to a07ea6f616a8e32a1 at its next tool ' +
      'round.","pin":{"id":"a07ea6f616a8e32a1","name":"a07ea6f616a8e32a1","ref":"22a663"}}'
  }
}
