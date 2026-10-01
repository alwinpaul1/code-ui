import type { NativeChatBlock } from '../../../../src/shared/native-chat-types'
import { asyncAgentLaunchResult } from './claude-parallel-agents-2.1.281'

// The run behind the user's two screenshots of 2026-10-01, one turn of Claude
// Code: a CronDelete, three Bash commands and a background Agent. The Claude
// app drew "Running agent ›" for it while the agent worked, and behind the tap
// a sheet titled "Used a tool, ran 3 commands, ran an agent" with the rows
//   Used CronDelete  id          (the input key muted)
//   Ran  <the Bash call's description>        (three times)
//   Ran agent  Fable: diagnose slow job, fix plan
// SHAPE ONLY: the screenshots carry no tool_use records, so the inputs are
// stand-ins of the same shape (a CronDelete holds one `id`; a Bash call holds
// `command` and `description`; an Agent holds `description` and `prompt`).
// The host name, job details and descriptions are the user's and are replaced.

export const MIXED_RUN_AGENT_ID = 'a3f6c1d29b7e45018'
export const MIXED_RUN_AGENT_DESCRIPTION = 'Fable: diagnose slow job, fix plan'
export const MIXED_RUN_BASH_DESCRIPTIONS = [
  'Cancel our two pending jobs on the build host',
  'Gather the resume notes for the driver',
  'Read the retry timeout note and its history'
] as const

export function mixedRunWithBackgroundAgent(): NativeChatBlock[] {
  return [
    { type: 'tool-call', name: 'CronDelete', input: { id: '80ceeb4b' }, state: 'completed' },
    { type: 'tool-result', output: 'Cancelled scheduled task 80ceeb4b' },
    {
      type: 'tool-call',
      name: 'Bash',
      input: { command: 'ssh -o ConnectTimeout=15 build-host bash -s <<EOF\nqueue cancel 1 2\nEOF', description: MIXED_RUN_BASH_DESCRIPTIONS[0] },
      state: 'completed'
    },
    { type: 'tool-result', output: 'cancelled 2 jobs' },
    {
      type: 'tool-call',
      name: 'Bash',
      input: { command: 'cat ~/notes/driver-resume.md | head -40', description: MIXED_RUN_BASH_DESCRIPTIONS[1] },
      state: 'completed'
    },
    { type: 'tool-result', output: '# Driver resume notes' },
    {
      type: 'tool-call',
      name: 'Bash',
      input: { command: 'grep -n timeout ~/notes/retry.md', description: MIXED_RUN_BASH_DESCRIPTIONS[2] },
      state: 'completed'
    },
    { type: 'tool-result', output: '12: timeout = 40 rounds' },
    {
      type: 'tool-call',
      name: 'Agent',
      input: {
        description: MIXED_RUN_AGENT_DESCRIPTION,
        prompt: 'Find why the nightly job is slow and write a fix plan.',
        subagent_type: 'general-purpose',
        run_in_background: true
      },
      state: 'completed'
    },
    { type: 'tool-result', output: asyncAgentLaunchResult(MIXED_RUN_AGENT_ID) }
  ]
}
