import { describe, expect, it } from 'vitest'
import {
  claudeConfigDirFromTranscriptPath,
  nativeChatAgentFromTranscriptPath
} from './mobile-native-chat-session-agent'

// Real paths, copied off this machine 2026-09-14 rather than invented: an
// invented fixture agrees with an invented matcher and both stay wrong.
const CLAUDE_TRANSCRIPT =
  '/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Code-UI/' +
  '11ab2e5b-269d-41ec-ac14-6f4cd692eead.jsonl'
const CODEX_TRANSCRIPT =
  '/Users/alwinpaul/.codex/sessions/2026/09/11/' +
  'rollout-2026-09-11T02-42-13-01a08dea-3c89-78e0-b629-04a87f33c43e.jsonl'

describe('naming the agent that wrote a captured transcript', () => {
  it('reads Claude Code off its own projects layout', () => {
    expect(nativeChatAgentFromTranscriptPath(CLAUDE_TRANSCRIPT)).toBe('claude')
  })

  it('reads Codex off its own rollout layout', () => {
    expect(nativeChatAgentFromTranscriptPath(CODEX_TRANSCRIPT)).toBe('codex')
  })

  it('reads the same layouts when a Windows host reports them with backslashes', () => {
    expect(
      nativeChatAgentFromTranscriptPath(
        'C:\\Users\\alwinpaul\\.claude\\projects\\-C--repo\\11ab2e5b.jsonl'
      )
    ).toBe('claude')
  })

  it('says nothing about a transcript it does not recognise', () => {
    // Grok and omp disclose no transcript path at all, and Pi writes its own
    // session file elsewhere; picking the likelier agent here would point a
    // Claude reader at another agent's real session file.
    expect(nativeChatAgentFromTranscriptPath('/tmp/pi-session-1.jsonl')).toBeNull()
    expect(nativeChatAgentFromTranscriptPath('/Users/me/.gemini/tmp/chat.jsonl')).toBeNull()
    expect(nativeChatAgentFromTranscriptPath(null)).toBeNull()
    expect(nativeChatAgentFromTranscriptPath('')).toBeNull()
  })

  it('refuses a directory or a truncated path that only shares the prefix', () => {
    expect(nativeChatAgentFromTranscriptPath('/Users/me/.claude/projects')).toBeNull()
    expect(nativeChatAgentFromTranscriptPath('/Users/me/.claude/projects/-repo')).toBeNull()
    expect(nativeChatAgentFromTranscriptPath('/Users/me/.codex/sessions/2026')).toBeNull()
  })
})

// Claude Code writes under $CLAUDE_CONFIG_DIR/projects/ when that is set, and
// this machine runs profiles such as ~/.claude-work. The 1037 pane's transcript
// below is the path Orca 1.4.211 saved for it on 2026-09-25 (Claude Code
// 2.1.282, agent-hooks/last-status.json), and the file is on disk. That pane
// had a session and a transcript and still got no chat once its status lost
// the agent name, because only `.claude/projects/` was recognised.
const SESSION = 'ad1e3053-f9ac-40be-80be-8f33a800e9b1'
const NEXOS = '-Users-alwinpaul-Desktop-NexDash-NexOS'
const PROFILE_TRANSCRIPT = `/Users/alwinpaul/.claude-work/projects/${NEXOS}/${SESSION}.jsonl`

describe('naming Claude from a transcript under a config dir other than ~/.claude', () => {
  it('offers chat on a Claude pane whose transcript sits in a ~/.claude-work profile', () => {
    expect(nativeChatAgentFromTranscriptPath(PROFILE_TRANSCRIPT)).toBe('claude')
  })

  it('offers chat whatever the config dir is called', () => {
    expect(
      nativeChatAgentFromTranscriptPath(`/Users/alwinpaul/profiles/work/projects/${NEXOS}/${SESSION}.jsonl`)
    ).toBe('claude')
  })

  it('reads a Windows profile reported with backslashes', () => {
    // Not captured: there is no Windows host here. Claude Code turns every
    // character of the working directory that is not a letter or digit into
    // `-`, so C:\Users\alwinpaul\repo becomes C--Users-alwinpaul-repo.
    expect(
      nativeChatAgentFromTranscriptPath(
        `C:\\Users\\alwinpaul\\.claude-work\\projects\\C--Users-alwinpaul-repo\\${SESSION}.jsonl`
      )
    ).toBe('claude')
  })

  it('still names Codex from its rollout, and Claude only from its own layout', () => {
    expect(nativeChatAgentFromTranscriptPath(CODEX_TRANSCRIPT)).toBe('codex')
    expect(nativeChatAgentFromTranscriptPath(CLAUDE_TRANSCRIPT)).toBe('claude')
  })

  it("does not claim OpenClaude's own transcripts, which keep Claude's layout", () => {
    // Orca installs OpenClaude's hooks under ~/.openclaude (OPENCLAUDE_HOOK_SETTINGS).
    expect(
      nativeChatAgentFromTranscriptPath(`/Users/alwinpaul/.openclaude/projects/${NEXOS}/${SESSION}.jsonl`)
    ).toBeNull()
  })

  it('says nothing when a path sits in a Codex home or fits both layouts', () => {
    expect(
      nativeChatAgentFromTranscriptPath(`/Users/alwinpaul/.codex/projects/${NEXOS}/${SESSION}.jsonl`)
    ).toBeNull()
    expect(
      nativeChatAgentFromTranscriptPath(
        `/Users/alwinpaul/.codex/sessions/2026/09/25/projects/${NEXOS}/${SESSION}.jsonl`
      )
    ).toBeNull()
  })

  it("does not take a folder of the user's own called projects for a Claude home", () => {
    // Claude's project directory is always the dashed working directory.
    expect(
      nativeChatAgentFromTranscriptPath(`/Users/alwinpaul/Desktop/projects/nexos/${SESSION}.jsonl`)
    ).toBeNull()
    // And its transcripts are named for the session.
    expect(
      nativeChatAgentFromTranscriptPath(`/Users/alwinpaul/.claude-work/projects/${NEXOS}/notes.jsonl`)
    ).toBeNull()
  })

  it('does not take a subagent transcript for the pane session', () => {
    expect(
      nativeChatAgentFromTranscriptPath(
        '/Users/alwinpaul/.claude-work/projects/-Users-alwinpaul-Desktop-Project-Code-UI/' +
          'e3d959fd-581d-48cb-95dd-cf4135f9577a/subagents/agent-ac783102d52898c35.jsonl'
      )
    ).toBeNull()
  })

  it("says nothing about the JSON Lines files other agents on this machine write", () => {
    // Real paths, 2026-09-25: Droid, Antigravity and Grok.
    for (const path of [
      '/Users/alwinpaul/.factory/sessions/8f47c57b-f669-4c80-9609-7ebe34d8fa10.jsonl',
      '/Users/alwinpaul/.gemini/antigravity-cli/brain/380bda45-f8e9-48eb-9b4d-208b89c26044/' +
        '.system_generated/logs/transcript.jsonl',
      '/Users/alwinpaul/.grok/sessions/%2FUsers%2Falwinpaul%2FDesktop%2FProject%2FCode%20UI/' +
        'prompt_history.jsonl'
    ]) {
      expect(nativeChatAgentFromTranscriptPath(path)).toBeNull()
    }
  })

  it('refuses a profile directory or a truncated path', () => {
    expect(nativeChatAgentFromTranscriptPath('/Users/alwinpaul/.claude-work/projects')).toBeNull()
    expect(
      nativeChatAgentFromTranscriptPath(`/Users/alwinpaul/.claude-work/projects/${NEXOS}`)
    ).toBeNull()
    expect(nativeChatAgentFromTranscriptPath(`projects/${NEXOS}/${SESSION}.jsonl`)).toBeNull()
  })
})

// Codex writes under $CODEX_HOME/sessions/, and Orca sets CODEX_HOME in the
// environment of every terminal it opens once it manages the Codex home
// (ipc/pty/host-env/assembly.ts, read off Orca main 2026-09-23): the shared
// `<userData>/codex-runtime-home/home`, or `<userData>/codex-accounts/<id>/home`
// for a managed account. A `codex` typed into such a terminal writes its
// rollout there, as Orca's own resolver says (native-chat/session-file-resolver.ts:
// "rollout files land under `<managed home>/sessions`, NOT `~/.codex/sessions`").
// The path below is the one rollout Orca's runtime home holds on this
// machine, on disk 2026-09-25.
const ORCA_USER_DATA = '/Users/alwinpaul/Library/Application Support/orca'
const ROLLOUT_NAME = 'rollout-2026-09-05T10-52-04-01a070c4-8dde-7ad2-9ee4-0410a6b8e0c0.jsonl'
const RUNTIME_HOME_ROLLOUT = `${ORCA_USER_DATA}/codex-runtime-home/home/sessions/2026/09/05/${ROLLOUT_NAME}`

describe('naming Codex from a rollout under a Codex home other than ~/.codex', () => {
  it("offers chat on a Codex pane whose rollout sits in Orca's own Codex home", () => {
    expect(nativeChatAgentFromTranscriptPath(RUNTIME_HOME_ROLLOUT)).toBe('codex')
  })

  it('offers chat on a Codex pane running under a managed Codex account', () => {
    // Not captured: there is no managed account on this machine. The home is
    // Orca's `join(userData, 'codex-accounts')/<account id>/home`.
    expect(
      nativeChatAgentFromTranscriptPath(
        `${ORCA_USER_DATA}/codex-accounts/3f2b9c1e-7a4d-4e8f-9b6a-1c2d3e4f5a6b/home/sessions/2026/09/05/${ROLLOUT_NAME}`
      )
    ).toBe('codex')
  })

  it('offers chat whatever CODEX_HOME is called', () => {
    expect(
      nativeChatAgentFromTranscriptPath(`/Users/alwinpaul/work/codex-home/sessions/2026/09/05/${ROLLOUT_NAME}`)
    ).toBe('codex')
  })

  it('reads a managed Codex home reported with backslashes', () => {
    // Not captured: there is no Windows host here.
    expect(
      nativeChatAgentFromTranscriptPath(
        `C:\\Users\\alwinpaul\\AppData\\Roaming\\orca\\codex-runtime-home\\home\\sessions\\2026\\09\\05\\${ROLLOUT_NAME}`
      )
    ).toBe('codex')
  })

  it("does not take a dated folder of the user's own called sessions for a Codex home", () => {
    expect(nativeChatAgentFromTranscriptPath('/Users/alwinpaul/notes/sessions/2026/09/05/standup.jsonl')).toBeNull()
    // A rollout is named for its start time and its thread id.
    expect(
      nativeChatAgentFromTranscriptPath('/Users/alwinpaul/notes/sessions/2026/09/05/rollout-draft.jsonl')
    ).toBeNull()
    // Muse shards by date too, but names the file session.jsonl
    // (Orca's shared/muse-session-log.ts).
    expect(
      nativeChatAgentFromTranscriptPath(
        '/Users/alwinpaul/.local/share/muse/sessions/2026/09/05/01a070c4-8dde-7ad2-9ee4-0410a6b8e0c0/session.jsonl'
      )
    ).toBeNull()
  })

  it('refuses a Codex home directory, or a rollout with no home above its sessions folder', () => {
    expect(nativeChatAgentFromTranscriptPath(`${ORCA_USER_DATA}/codex-runtime-home/home/sessions`)).toBeNull()
    expect(nativeChatAgentFromTranscriptPath(`sessions/2026/09/05/${ROLLOUT_NAME}`)).toBeNull()
  })
})

// Claude Code loads a session's skills, commands and plugins from its config
// dir, and the transcript path is the session saying which dir that is. This
// one is the path Orca 1.4.211 saved for a Code UI pane here on 2026-09-25.
const CODE_UI_TRANSCRIPT =
  '/Users/alwinpaul/.claude-work/projects/-Users-alwinpaul-Desktop-Project-Code-UI/' +
  '967668df-a7d9-40e7-964b-7812815c010d.jsonl'

describe('reading the config dir a Claude session runs under off its transcript', () => {
  it('names the ~/.claude-work profile for a session that writes there', () => {
    expect(claudeConfigDirFromTranscriptPath(CODE_UI_TRANSCRIPT)).toBe('/Users/alwinpaul/.claude-work')
    expect(claudeConfigDirFromTranscriptPath(PROFILE_TRANSCRIPT)).toBe('/Users/alwinpaul/.claude-work')
  })

  it('names ~/.claude for a session in the default config dir', () => {
    expect(claudeConfigDirFromTranscriptPath(CLAUDE_TRANSCRIPT)).toBe('/Users/alwinpaul/.claude')
  })

  it("keeps a Windows profile in the host's own spelling", () => {
    expect(
      claudeConfigDirFromTranscriptPath(
        `C:\\Users\\alwinpaul\\.claude-work\\projects\\C--Users-alwinpaul-repo\\${SESSION}.jsonl`
      )
    ).toBe('C:\\Users\\alwinpaul\\.claude-work')
  })

  it('names no config dir for a transcript it does not take for Claude', () => {
    expect(claudeConfigDirFromTranscriptPath(CODEX_TRANSCRIPT)).toBeNull()
    expect(claudeConfigDirFromTranscriptPath(RUNTIME_HOME_ROLLOUT)).toBeNull()
    expect(
      claudeConfigDirFromTranscriptPath(`/Users/alwinpaul/.openclaude/projects/${NEXOS}/${SESSION}.jsonl`)
    ).toBeNull()
    expect(
      claudeConfigDirFromTranscriptPath(
        `/Users/alwinpaul/.codex/sessions/2026/09/25/projects/${NEXOS}/${SESSION}.jsonl`
      )
    ).toBeNull()
    expect(
      claudeConfigDirFromTranscriptPath(
        `/Users/alwinpaul/.claude-work/projects/${NEXOS}/${SESSION}/subagents/agent-ac783102d52898c35.jsonl`
      )
    ).toBeNull()
    expect(claudeConfigDirFromTranscriptPath(null)).toBeNull()
    expect(claudeConfigDirFromTranscriptPath('')).toBeNull()
  })

  it('names no config dir for a relative path, which the host could not list', () => {
    expect(claudeConfigDirFromTranscriptPath(`.claude-work/projects/${NEXOS}/${SESSION}.jsonl`)).toBeNull()
    expect(claudeConfigDirFromTranscriptPath(`.claude/projects/${NEXOS}/${SESSION}.jsonl`)).toBeNull()
  })
})
