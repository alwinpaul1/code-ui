import { describe, expect, it } from 'vitest'
import {
  claudePluginCachePath,
  claudeSkillRoots,
  dedupeBrowsedSkills,
  grokSkillRoots,
  pluginSkillsRoot,
  skillsFromRootListing,
  worktreePathFromId
} from './mobile-native-chat-skill-browse'
import { nativeChatSkillCommandName } from './mobile-native-chat-skill-command'

// Listings as `files.browseServerDir` returned them on this machine,
// 2026-09-20 (Orca 1.4.205), trimmed to the entries that matter.
const HOME = '/Users/alwinpaul'
const dir = (name: string) => ({ name, isDirectory: true, isSymlink: false })
const file = (name: string) => ({ name, isDirectory: false, isSymlink: false })

describe('skills the phone lists by directory name', () => {
  it('reads the Claude profiles that exist for a worktree', () => {
    expect(claudeSkillRoots(HOME, '/Users/alwinpaul/Desktop/Project/Code UI').map((r) => r.path)).toEqual([
      '/Users/alwinpaul/.claude/skills',
      '/Users/alwinpaul/.claude/commands',
      '/Users/alwinpaul/.claude-work/skills',
      '/Users/alwinpaul/.claude-work/commands',
      '/Users/alwinpaul/Desktop/Project/Code UI/.claude/skills',
      '/Users/alwinpaul/Desktop/Project/Code UI/.claude/commands'
    ])
    expect(worktreePathFromId('a91672c3-9ec9-4147-9dfc-5a1a60bc5308::/Users/alwinpaul/Desktop/Project/Code UI')).toBe(
      '/Users/alwinpaul/Desktop/Project/Code UI'
    )
    expect(worktreePathFromId('w1')).toBeNull()
  })

  it('reads the Grok profile when that directory is the one that exists', () => {
    expect(grokSkillRoots(HOME, '/Users/alwinpaul/Desktop/Project/Code UI').map((root) => root.path)).toEqual([
      '/Users/alwinpaul/.grok/skills',
      '/Users/alwinpaul/Desktop/Project/Code UI/.grok/skills'
    ])
    const [home] = grokSkillRoots(HOME, null)
    const listed = skillsFromRootListing(home!, [dir('commit'), dir('_sources')])
    expect(listed.map((entry) => entry.name)).toEqual(['commit'])
    expect(listed[0]).toMatchObject({ providers: [], sourceLabel: 'Grok skills' })
  })

  // 2026-09-20, phone beside the Claude app for "/ani": the Claude app listed
  // animation-vocabulary, find-animation-opportunities, improve-animations,
  // review-animations and the-humanizer; the phone listed the-humanizer alone.
  // 102 of this machine's 215 skill entries are SYMLINKS (to ~/.claude-work),
  // which the host lists as `isDirectory: false, isSymlink: true`, and the
  // reader took directories only. Claude Code follows the link.
  const link = (name: string) => ({ name, isDirectory: false, isSymlink: true })

  it('offers every skill directory of ~/.claude/skills, symlinked ones too, not the holding folders', () => {
    const [home] = claudeSkillRoots(HOME, null)
    const skills = skillsFromRootListing(home!, [
      dir('_sources'),
      dir('academic-research-writer'),
      dir('academic-researcher'),
      link('agents-sdk'),
      link('animation-vocabulary'),
      dir('.DS_Store_dir'),
      file('README.md')
    ])
    expect(skills.map((s) => nativeChatSkillCommandName(s))).toEqual([
      'academic-research-writer',
      'academic-researcher',
      'agents-sdk',
      'animation-vocabulary'
    ])
    // A link is confirmed by listing what it points at; a plain folder need not be.
    expect(skills.map((s) => s.id.startsWith('browse-link:'))).toEqual([false, false, true, true])
    expect(skills[0]).toMatchObject({
      sourceKind: 'home',
      providers: ['claude'],
      description: null,
      skillFilePath: '/Users/alwinpaul/.claude/skills/academic-research-writer/SKILL.md'
    })
  })

  it('offers a command file by its name without the extension', () => {
    const commands = claudeSkillRoots(HOME, null)[1]!
    expect(skillsFromRootListing(commands, [file('deploy.md'), file('notes.txt'), dir('sub')]).map((s) => s.name)).toEqual([
      'deploy'
    ])
  })

  it('offers a cached plugin skill as /plugin:skill, once across versions', () => {
    const cache = claudePluginCachePath(HOME)
    expect(cache).toBe('/Users/alwinpaul/.claude/plugins/cache')
    const v1 = pluginSkillsRoot(cache, 'typesafe-ai', 'typesafe', '0.5.7')
    expect(v1.path).toBe('/Users/alwinpaul/.claude/plugins/cache/typesafe-ai/typesafe/0.5.7/skills')
    const listed = [
      ...skillsFromRootListing(pluginSkillsRoot(cache, 'claude-plugins-official', 'frontend-design', '3da105324a27'), [dir('frontend-design')]),
      ...skillsFromRootListing(pluginSkillsRoot(cache, 'claude-plugins-official', 'frontend-design', 'unknown'), [dir('frontend-design')]),
      ...skillsFromRootListing(v1, [dir('typesafe-ai')])
    ]
    expect(dedupeBrowsedSkills(listed).map((s) => nativeChatSkillCommandName(s))).toEqual([
      'frontend-design:frontend-design',
      'typesafe:typesafe-ai'
    ])
  })

  it('keeps a Grok skill that shares its name with a Claude skill', () => {
    const claude = skillsFromRootListing(claudeSkillRoots(HOME, null)[0]!, [dir('commit')])
    const grok = skillsFromRootListing(grokSkillRoots(HOME, null)[0]!, [dir('commit')])
    expect(dedupeBrowsedSkills([...claude, ...grok]).map((entry) => entry.sourceLabel)).toEqual([
      'Home skills',
      'Grok skills'
    ])
  })
})
