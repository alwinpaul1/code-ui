// docs/claude-app-parity.md item 3: the count of a created file the wire cut,
// read back from the file itself.
//
// Orca's mobile diet keeps 4000 characters of a tool call's input, and a
// Claude Write keeps its lines nowhere else, so a create over the budget
// reaches the phone as a prefix and `… (truncated)`, with no line count. The
// desktop still has the file. Its count is the create's count only when the
// file is provably the one the Write made:
//
// - it still starts with every character the wire kept, and
// - no later call in the loaded transcript may have changed it: an edit tool
//   naming the same path, any other call naming the file (a command the user
//   ran with `!` among them, unless it only makes the file executable, runs,
//   reads or stages it: mobile-native-chat-created-file-commands.ts), any
//   call the wire cut (the part it dropped may have named it), or a subagent
//   launched or a message sent after it (the agent's own calls are not in
//   this transcript), and
// - no background work launched before it was still running when it landed
//   (mobile-native-chat-created-file-work.ts).
//
// Anything else is no number, as before. The count itself is the uncut
// Write's count, taken through the same pipeline, so a small create and a
// large one agree. The reading is in mobile-native-chat-created-file-count-store.ts.

import type {
  NativeChatBlock,
  NativeChatMessage,
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'
import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import {
  carriesMobileCut,
  editFileCountIsWhole,
  inputStrings,
  MOBILE_CUT
} from './mobile-native-chat-edit-wire-cut'
import { commandLeavesFileAlone } from './mobile-native-chat-created-file-commands'
import { backgroundWorkRunningAt } from './mobile-native-chat-created-file-work'
import { editFilesForToolCall } from './mobile-native-chat-tool-run-diff-stat'
import { toolCallKind } from './mobile-native-chat-tool-sentence'

/** A Write whose content the wire cut: the path it names, and what the wire
 *  kept. The key is both, so two creates of one path with different content
 *  are two creates. */
export type CutCreate = { key: string; path: string; prefix: string }

export type CreatedFileRefusal = 'cut-read' | 'binary' | 'changed' | 'uncountable'

export type CreatedFileVerdict =
  | { kind: 'counted'; added: number }
  | { kind: 'refused'; reason: CreatedFileRefusal }

/** The file as `files.read` returned it. */
export type CreatedFileText = { content: string; truncated: boolean }

/** Tools that read and never write. */
const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS'])
/** Tools that change the one file their structured path names. */
const PATH_EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const PATH_KEYS = ['file_path', 'notebook_path', 'path'] as const
/** A character that continues a file name on its left. A `.` does, since
 *  `a.queue.sh` is not `queue.sh`. */
const NAME_BEFORE = /[A-Za-z0-9._-]/
/** A character that continues a file name on its right. A `.` does not: the
 *  name may end a sentence, or be the stem of `name.sh.new`, which a command
 *  can move over it. */
const NAME_AFTER = /[A-Za-z0-9_-]/
/** A word's start that is a cluster of short options, quoted or not: the
 *  last of them may take the name glued on as its value (`wget -qOname`,
 *  `sort -oname`). */
const GLUED_OPTIONS = /(?:^|\s)["']?-+[A-Za-z0-9]*$/

function stringField(input: unknown, key: string): string | null {
  if (typeof input !== 'object' || input === null) {
    return null
  }
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

/** The Write call's path and kept prefix, when the wire cut its content and
 *  kept at least one character of it. */
function cutWriteOf(call: NativeChatToolCallBlock): CutCreate | null {
  if (call.name !== 'Write') {
    return null
  }
  const path = stringField(call.input, 'file_path')
  const content = stringField(call.input, 'content')
  if (!path || path.endsWith(MOBILE_CUT) || content === null || !content.endsWith(MOBILE_CUT)) {
    return null
  }
  const prefix = content.slice(0, -MOBILE_CUT.length)
  if (prefix === '') {
    return null
  }
  return { key: `${path}\u0000${prefix}`, path, prefix }
}

/** A cut Write that landed as a create. A Write that overwrote a file, failed,
 *  or has no answer yet is not one: its count is not the file's. */
export function cutCreateOf(
  call: NativeChatToolCallBlock,
  result: NativeChatToolResultBlock | null
): CutCreate | null {
  const create = cutWriteOf(call)
  if (!create || !result || (result.editPatch?.hunks.length ?? 0) > 0) {
    return null
  }
  const files = editFilesForToolCall(call, result)
  return files?.length === 1 && files[0]?.changeKind === 'added' ? create : null
}

/** Every cut create in a run of tool blocks, in order. */
export function cutCreatesIn(blocks: readonly NativeChatBlock[]): CutCreate[] {
  const creates: CutCreate[] = []
  for (const pair of pairToolBlocks(blocks)) {
    const create = pair.call ? cutCreateOf(pair.call, pair.result ?? null) : null
    if (create) {
      creates.push(create)
    }
  }
  return creates
}

/** What an uncut Write of `content` counts, through the same pipeline the
 *  chip reads: null where it would draw no chip (an empty file, one past the
 *  row or character cap). */
export function createdFileLineCount(content: string): number | null {
  const files = editFilesForToolCall(
    { type: 'tool-call', name: 'Write', input: { file_path: 'created', content } },
    { type: 'tool-result', output: 'File created successfully at: created' }
  )
  const file = files?.length === 1 ? files[0] : undefined
  return file && editFileCountIsWhole(file) ? file.added : null
}

function foldNewlines(text: string): string {
  return text.replaceAll('\r\n', '\n')
}

/** The kept prefix, less a last character the cut may have split: the CR of
 *  a CRLF (the file has the pair, folded to LF), or the U+FFFD the relay may
 *  put in place of half a surrogate pair. A half kept as is needs nothing: it
 *  is the file's own first half. */
function comparablePrefix(prefix: string): string {
  const folded = foldNewlines(prefix)
  const last = folded.charCodeAt(folded.length - 1)
  const splitLast = last === 0x0d || last === 0xfffd
  return splitLast ? folded.slice(0, -1) : folded
}

/** Whether the file as read now is the one the create made, and if so its
 *  count. Refuses a read the host cut, a binary file, a file that does not go
 *  on past everything the wire kept, and one the uncut pipeline would not
 *  count. */
export function judgeCreatedFile(create: CutCreate, file: CreatedFileText): CreatedFileVerdict {
  if (file.truncated) {
    return { kind: 'refused', reason: 'cut-read' }
  }
  if (file.content.includes('\u0000')) {
    return { kind: 'refused', reason: 'binary' }
  }
  const kept = comparablePrefix(create.prefix)
  const now = foldNewlines(file.content)
  // The wire cuts only a string longer than what it keeps, so the file the
  // create made goes on past the prefix.
  if (now.length <= kept.length || !now.startsWith(kept)) {
    return { kind: 'refused', reason: 'changed' }
  }
  const added = createdFileLineCount(file.content)
  return added === null ? { kind: 'refused', reason: 'uncountable' } : { kind: 'counted', added }
}

function normalizedPath(path: string): string {
  return path.replaceAll('\\ ', ' ').replaceAll('\\', '/').toLowerCase()
}

/** The path with its `.` and `..` segments resolved as far as the path
 *  itself allows. A `..` above a relative path's start is dropped, and what
 *  is left is matched as a suffix: for a touch that finds more of them, which
 *  refuses, and for `isTheFile`, where a match keeps a count, it lets a
 *  relative name run from another folder pass, since the folder the shell
 *  was in is not in the transcript. */
function collapsedPath(path: string): string {
  const kept: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '..') {
      kept.pop()
    } else if (segment !== '' && segment !== '.') {
      kept.push(segment)
    }
  }
  return `${path.startsWith('/') ? '/' : ''}${kept.join('/')}`
}

/** The home folder a normalised path spells out: `/users/x`, `/home/x`,
 *  `c:/users/x` or `/root`. macOS's /Users/Shared is no one's, nor are
 *  Windows' Public, Default, Default User and All Users. */
const HOME =
  /^(?:(?:[a-z]:)?\/users\/(?!(?:shared|public|default|default user|all users)(?:\/|$))[^/]+|\/home\/[^/]+|\/root)(?=\/|$)/
const ABSOLUTE = /^(?:[a-z]:)?\//

function fromHome(path: string): boolean {
  return path === '~' || path.startsWith('~/')
}

/** A path from `~`, spelled out against the home the other path is under.
 *  When it is under none, `~/rest` is matched as the relative `rest`: for a
 *  touch that finds more of them, which refuses. `isTheFile`, where a match
 *  keeps a count, takes that guess only against a relative path, which is
 *  matched as a suffix all the same. */
function expandedHome(path: string, other: string): string {
  if (!fromHome(path)) {
    return path
  }
  const rest = path.slice(2)
  const home = HOME.exec(other)?.[0]
  return home ? `${home}/${rest}` : rest
}

function samePath(a: string, b: string): boolean {
  // Two paths from `~` start in the one home, so only the whole of each
  // names the same file.
  if (fromHome(a) && fromHome(b)) {
    return collapsedPath(a) === collapsedPath(b)
  }
  const x = collapsedPath(expandedHome(a, b))
  const y = collapsedPath(expandedHome(b, a))
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`)
}

function namesFile(word: string, name: string): boolean {
  let at = word.indexOf(name)
  while (at !== -1) {
    const before = at === 0 ? '' : word.charAt(at - 1)
    const after = word.charAt(at + name.length)
    const starts = !NAME_BEFORE.test(before) || GLUED_OPTIONS.test(word.slice(0, at))
    if (starts && !NAME_AFTER.test(after)) {
      return true
    }
    at = word.indexOf(name, at + 1)
  }
  return false
}

/** Every string in a call's input, normalised for matching once per call. */
const wordsOfCall = new WeakMap<NativeChatToolCallBlock, string[]>()

function callWords(call: NativeChatToolCallBlock): string[] {
  const cached = wordsOfCall.get(call)
  if (cached) {
    return cached
  }
  const words = inputStrings(call.input).map(normalizedPath)
  wordsOfCall.set(call, words)
  return words
}

/** Whether `call`, run after the create of `path`, may have changed it. */
function mayTouch(call: NativeChatToolCallBlock, path: string): boolean {
  if (READ_ONLY_TOOLS.has(call.name)) {
    return false
  }
  // A subagent's own calls are in its sidechain, not this transcript, so what
  // its prompt names says nothing about what it edited. A message wakes an
  // agent or reaches a teammate, whose calls are not here either.
  const kind = toolCallKind(call.name)
  if (kind === 'agent' || kind === 'message') {
    return true
  }
  const target = normalizedPath(path)
  if (PATH_EDIT_TOOLS.has(call.name)) {
    const named = PATH_KEYS.map((key) => stringField(call.input, key)).find((value) => value)
    if (named && !named.endsWith(MOBILE_CUT)) {
      return samePath(normalizedPath(named), target)
    }
  }
  if (carriesMobileCut(call.input)) {
    return true
  }
  const name = lastSegment(target)
  if (name === '' || !callWords(call).some((word) => namesFile(word, name))) {
    return name === ''
  }
  const command = kind === 'command' ? stringField(call.input, 'command') : null
  return command === null || !commandLeavesFileAlone(command, (word) => isTheFile(word, target))
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** `~name`, another user's home, or `~+`, `~-` and a zsh named folder:
 *  somewhere the transcript does not say. */
const OTHER_TILDE = /^~[^/]/

/** Whether a command's word is the file's own path, or its name. A path
 *  from `~` is not the file when the other side is absolute and under no
 *  home: `bash ~/queue.sh` runs another script than /opt/work/jobs/queue.sh
 *  or /Users/Shared/queue.sh. Nor is a path from any other `~` word, which
 *  would otherwise be matched as a relative name. */
function isTheFile(word: string, target: string): boolean {
  const spelled = normalizedPath(word)
  const outsideTheHome = (a: string, b: string) => fromHome(a) && ABSOLUTE.test(b) && !HOME.test(b)
  if (outsideTheHome(spelled, target) || outsideTheHome(target, spelled)) {
    return false
  }
  if (OTHER_TILDE.test(spelled) || OTHER_TILDE.test(target)) {
    return false
  }
  return lastSegment(spelled) === lastSegment(target) && samePath(spelled, target)
}

/** A command the user ran with `!`. Claude Code writes it as a user turn,
 *  `<bash-input>…</bash-input>`, raw, and Orca hands the phone that turn as
 *  text. One the wire cut has lost its closing tag. */
const USER_COMMAND = /<bash-input>([\s\S]*?)(?:<\/bash-input>|$)/g

/** The `!` commands in a user's text block, as the Bash calls they amount
 *  to. The agent's own prose may quote one; that ran nothing. */
function userCommandCalls(
  message: NativeChatMessage,
  block: NativeChatBlock
): NativeChatToolCallBlock[] {
  if (message.role !== 'user' || block.type !== 'text' || !block.text.includes('<bash-input>')) {
    return []
  }
  return [...block.text.matchAll(USER_COMMAND)].map((match) => ({
    type: 'tool-call',
    name: 'Bash',
    input: { command: match[1] ?? '' }
  }))
}

/** Where a cut create stands in the loaded transcript: the message holding
 *  it, and whether a later call may have changed its file. */
export type CutCreateStanding = { messageId: string; touched: boolean }

/** Every cut create in the transcript, keyed by `CutCreate.key`. The same
 *  create twice counts as touched: the second wrote the file again, and so is
 *  one made while earlier background work was still running. */
export function cutCreateStandings(
  messages: readonly NativeChatMessage[]
): Map<string, CutCreateStanding> {
  const standings = new Map<string, CutCreateStanding>()
  const open: { path: string; standing: CutCreateStanding }[] = []
  const workRunningAt = backgroundWorkRunningAt(messages)
  for (const message of messages) {
    for (const block of message.blocks) {
      const calls = block.type === 'tool-call' ? [block] : userCommandCalls(message, block)
      for (const call of calls) {
        for (const { path, standing } of open) {
          if (!standing.touched && mayTouch(call, path)) {
            standing.touched = true
          }
        }
      }
      if (block.type !== 'tool-call') {
        continue
      }
      const create = cutWriteOf(block)
      if (create && !standings.has(create.key)) {
        const standing = { messageId: message.id, touched: workRunningAt(block) }
        standings.set(create.key, standing)
        open.push({ path: create.path, standing })
      }
    }
  }
  return standings
}
