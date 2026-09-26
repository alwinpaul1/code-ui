// A created file the wire cut has its count read back from the file itself,
// and only when the file is provably the one the Write made: it still starts
// with every character the wire kept, and nothing later in the transcript
// touched it. Everything else is no number, as before.

import { describe, expect, it } from 'vitest'
import type {
  NativeChatBlock,
  NativeChatMessage,
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'
import {
  createdFileLineCount,
  cutCreateOf,
  cutCreateStandings,
  judgeCreatedFile,
  type CutCreate
} from './mobile-native-chat-created-file-count'
import { toolRunDiffStat } from './mobile-native-chat-tool-run-diff-stat'
import {
  CLAUDE_EDIT_RUN_ROWS,
  CREATED_A_FILE_RUN,
  CREATED_FILE_ON_DISK
} from './fixtures/claude-edit-runs-2.1.282'

const CUT = '… (truncated)'

const WRITE = CREATED_A_FILE_RUN[0] as NativeChatToolCallBlock
const WRITE_RESULT = CREATED_A_FILE_RUN[1] as NativeChatToolResultBlock
const PATH = (WRITE.input as { file_path: string }).file_path

const WRITTEN = CREATED_FILE_ON_DISK

function theCreate(): CutCreate {
  const create = cutCreateOf(WRITE, WRITE_RESULT)
  if (!create) {
    throw new Error('the fixture Write is not a cut create')
  }
  return create
}

function write(path: string, content: string): NativeChatBlock[] {
  return [
    { type: 'tool-call', name: 'Write', input: { file_path: path, content } },
    { type: 'tool-result', output: `File created successfully at: ${path}` }
  ]
}

function rows(...blocks: NativeChatBlock[][]): NativeChatMessage[] {
  return blocks.map((row, index) => ({
    id: `row-${index}`,
    role: index % 2 === 0 ? 'assistant' : 'tool',
    blocks: row
  })) as NativeChatMessage[]
}

function call(name: string, input: unknown): NativeChatBlock[] {
  return [{ type: 'tool-call', name, input }]
}

describe('the created file the wire cut, read back', () => {
  it('is the fixture: the wire kept a prefix of the file the Write made', () => {
    expect(WRITTEN.split('\n')).toHaveLength(94)
    expect(WRITTEN.startsWith(theCreate().prefix)).toBe(true)
    expect(theCreate().path).toBe(PATH)
  })

  it('counts +93 from a file that still starts with everything the wire kept', () => {
    expect(judgeCreatedFile(theCreate(), { content: WRITTEN, truncated: false })).toEqual({
      kind: 'counted',
      added: 93
    })
  })

  it('draws no number when the file no longer starts with what the Write wrote', () => {
    const changedOutside = WRITTEN.replace('step 03', 'step 3b')
    expect(judgeCreatedFile(theCreate(), { content: changedOutside, truncated: false }).kind).toBe(
      'refused'
    )
  })

  it('draws no number for a file emptied since, or cut down to its first line', () => {
    expect(judgeCreatedFile(theCreate(), { content: '', truncated: false }).kind).toBe('refused')
    expect(judgeCreatedFile(theCreate(), { content: '#!/bin/bash\n', truncated: false }).kind).toBe(
      'refused'
    )
  })

  it('draws no number for a file cut down to exactly what the wire kept', () => {
    const kept = theCreate().prefix
    expect(judgeCreatedFile(theCreate(), { content: kept, truncated: false })).toEqual({
      kind: 'refused',
      reason: 'changed'
    })
  })

  it('draws no number for a read the host cut at its size cap', () => {
    expect(judgeCreatedFile(theCreate(), { content: WRITTEN, truncated: true }).kind).toBe(
      'refused'
    )
  })

  it('draws no number for a file that reads as binary', () => {
    const binary = `${WRITTEN}\u0000\u0001\u0002`
    expect(judgeCreatedFile(theCreate(), { content: binary, truncated: false }).kind).toBe(
      'refused'
    )
  })

  it('counts a file written with CRLF the same as with LF', () => {
    const crlf = WRITTEN.replaceAll('\n', '\r\n')
    expect(judgeCreatedFile(theCreate(), { content: crlf, truncated: false })).toEqual({
      kind: 'counted',
      added: 93
    })
  })

  it('counts a one-line file with no trailing newline as one line', () => {
    const line = `{"rows":[${'1,'.repeat(3000)}1]}`
    const [writeCall, result] = write('/w/data.json', `${line.slice(0, 3900)}${CUT}`)
    const create = cutCreateOf(
      writeCall as NativeChatToolCallBlock,
      result as NativeChatToolResultBlock
    )
    expect(create).not.toBeNull()
    expect(judgeCreatedFile(create!, { content: line, truncated: false })).toEqual({
      kind: 'counted',
      added: 1
    })
    expect(judgeCreatedFile(create!, { content: `${line}\n`, truncated: false })).toEqual({
      kind: 'counted',
      added: 1
    })
  })

  it('holds the file to a prefix the wire cut between a CR and its LF', () => {
    const file = `${'a\r\n'.repeat(2000)}`
    const kept = file.slice(0, 3002)
    expect(kept.endsWith('\r')).toBe(true)
    const [writeCall, result] = write('/w/crlf.txt', `${kept}${CUT}`)
    const create = cutCreateOf(
      writeCall as NativeChatToolCallBlock,
      result as NativeChatToolResultBlock
    )
    expect(judgeCreatedFile(create!, { content: file, truncated: false })).toEqual({
      kind: 'counted',
      added: 2000
    })
  })

  it('holds the file to a prefix the wire cut inside an emoji', () => {
    const file = `${'🙂'.repeat(2500)}\n`
    const kept = file.slice(0, 3999)
    const [writeCall, result] = write('/w/emoji.txt', `${kept}${CUT}`)
    const create = cutCreateOf(
      writeCall as NativeChatToolCallBlock,
      result as NativeChatToolResultBlock
    )
    expect(judgeCreatedFile(create!, { content: file, truncated: false })).toEqual({
      kind: 'counted',
      added: 1
    })
  })

  it('holds the file to a prefix whose split emoji the relay replaced with U+FFFD', () => {
    const file = `${'🙂'.repeat(2500)}\n`
    const kept = `${file.slice(0, 3998)}\uFFFD`
    const [writeCall, result] = write('/w/emoji.txt', `${kept}${CUT}`)
    const create = cutCreateOf(
      writeCall as NativeChatToolCallBlock,
      result as NativeChatToolResultBlock
    )
    expect(judgeCreatedFile(create!, { content: file, truncated: false })).toEqual({
      kind: 'counted',
      added: 1
    })
  })

  it('is no cut create when the wire kept none of the content', () => {
    const [writeCall, result] = write('/w/empty-kept.sh', CUT)
    expect(
      cutCreateOf(writeCall as NativeChatToolCallBlock, result as NativeChatToolResultBlock)
    ).toBeNull()
  })

  it('is no cut create for a Write that overwrote a file, or one that failed', () => {
    const [writeCall] = write(PATH, `${WRITTEN.slice(0, 3000)}${CUT}`)
    const overwrote: NativeChatToolResultBlock = {
      type: 'tool-result',
      output: `The file ${PATH} has been updated.`
    }
    const failed: NativeChatToolResultBlock = {
      type: 'tool-result',
      output: 'denied',
      isError: true
    }
    expect(cutCreateOf(writeCall as NativeChatToolCallBlock, overwrote)).toBeNull()
    expect(cutCreateOf(writeCall as NativeChatToolCallBlock, failed)).toBeNull()
    expect(cutCreateOf(writeCall as NativeChatToolCallBlock, null)).toBeNull()
  })

  it('is no cut create for a Write the wire did not cut', () => {
    const [writeCall, result] = write('/w/small.sh', 'echo hi\n')
    expect(
      cutCreateOf(writeCall as NativeChatToolCallBlock, result as NativeChatToolResultBlock)
    ).toBeNull()
  })
})

describe('a read-back count agrees with the count of an uncut Write', () => {
  const contents: [string, string][] = [
    ['an empty file', ''],
    ['one line with a newline', 'echo hi\n'],
    ['one line without one', 'echo hi'],
    ['a blank last line', 'a\nb\n\n'],
    ['CRLF', 'a\r\nb\r\n'],
    ['a lone CR', 'a\rb\n'],
    ['the line cap', 'x\n'.repeat(2000)],
    ['one past the line cap', 'x\n'.repeat(2001)],
    ['past the character cap', `${'y'.repeat(99)}\n`.repeat(1000)]
  ]
  it.each(contents)('%s', (_, content) => {
    const uncut = toolRunDiffStat(write('/w/f.txt', content))
    expect(createdFileLineCount(content)).toBe(uncut?.added ?? null)
  })
})

describe('a file touched after its create', () => {
  const create = write(PATH, `${WRITTEN.slice(0, 3896)}${CUT}`)
  const key = cutCreateOf(
    create[0] as NativeChatToolCallBlock,
    create[1] as NativeChatToolResultBlock
  )!.key

  it("is untouched in the report's own transcript, where a later git add names only the folder", () => {
    const touched = cutCreateStandings(CLAUDE_EDIT_RUN_ROWS)
    expect(touched.get(theCreate().key)?.touched).toBe(false)
  })

  it('is touched by a later Edit of the same path', () => {
    const later = call('Edit', { file_path: PATH, old_string: 'a', new_string: 'b' })
    expect(cutCreateStandings(rows(create, later)).get(key)?.touched).toBe(true)
  })

  it('is touched by a later MultiEdit or Write of the same path', () => {
    expect(
      cutCreateStandings(rows(create, call('MultiEdit', { file_path: PATH, edits: [] }))).get(key)
        ?.touched
    ).toBe(true)
    expect(cutCreateStandings(rows(create, write(PATH, 'echo replaced\n'))).get(key)?.touched).toBe(
      true
    )
  })

  // Review of 2026-09-26: the same file spelled with `.` or `..` segments
  // did not match, so an Edit of it left the create's count standing.
  it.each([
    ['a `.` segment', PATH.replace('/jobs/', '/jobs/./')],
    ['a `..` segment', PATH.replace('/cluster/jobs/', '/cluster/tmp/../jobs/')],
    ['a leading `./`', './hybrid-model/scripts/cluster/jobs/queue-sweep-k-one.sh'],
    ['a leading `../`', '../jobs/queue-sweep-k-one.sh']
  ])('is touched by a later Edit that spells its path with %s', (_, spelled) => {
    const later = call('Edit', { file_path: spelled, old_string: 'a', new_string: 'b' })
    expect(cutCreateStandings(rows(create, later)).get(key)?.touched).toBe(true)
  })

  // Review of 2026-09-26: a path spelled from `~` did not match the same
  // file spelled from `/Users/dev`, so an Edit of it left the count standing.
  const FROM_HOME = PATH.replace('/Users/dev/', '~/')

  it('is touched by a later Edit that spells its path from ~', () => {
    const later = call('Edit', { file_path: FROM_HOME, old_string: 'a', new_string: 'b' })
    expect(cutCreateStandings(rows(create, later)).get(key)?.touched).toBe(true)
  })

  it('is touched by a later Edit of the absolute path when the create spelled it from ~', () => {
    const fromHome = write(FROM_HOME, `${WRITTEN.slice(0, 3896)}${CUT}`)
    const homeKey = cutCreateOf(
      fromHome[0] as NativeChatToolCallBlock,
      fromHome[1] as NativeChatToolResultBlock
    )!.key
    const later = call('Edit', { file_path: PATH, old_string: 'a', new_string: 'b' })
    expect(cutCreateStandings(rows(fromHome, later)).get(homeKey)?.touched).toBe(true)
  })

  it.each([
    ['a Linux home', '/home/dev/jobs/queue.sh', '~/jobs/queue.sh'],
    ["root's home", '/root/jobs/queue.sh', '~/jobs/queue.sh'],
    ['a Windows home', 'C:\\Users\\dev\\jobs\\queue.sh', '~\\jobs\\queue.sh'],
    ['a folder under no home', '/opt/work/jobs/queue.sh', '~/jobs/queue.sh']
  ])('is touched by a later Edit from ~ of a file created under %s', (_, created, spelled) => {
    const made = write(created, `${'echo step\n'.repeat(500)}${CUT}`)
    const madeKey = cutCreateOf(
      made[0] as NativeChatToolCallBlock,
      made[1] as NativeChatToolResultBlock
    )!.key
    const later = call('Edit', { file_path: spelled, old_string: 'a', new_string: 'b' })
    expect(cutCreateStandings(rows(made, later)).get(madeKey)?.touched).toBe(true)
  })

  // Review of 2026-09-26: `bash ~/queue.sh` read as running the file
  // created at /opt/work/jobs/queue.sh, which is under no home, so the ~ has
  // nothing to spell out against, and kept its count. That command runs
  // another script, which may write the file.
  it.each([
    ['a command runs a script from ~ with its name', '/opt/work/jobs/queue.sh', 'bash ~/queue.sh'],
    [
      'a command runs it by a path under no home when the create spelled it from ~',
      '~/jobs/queue.sh',
      'bash /opt/work/jobs/queue.sh'
    ]
  ])('draws no count for a create when %s', (_, created, command) => {
    const made = write(created, `${'echo step\n'.repeat(500)}${CUT}`)
    const madeKey = cutCreateOf(
      made[0] as NativeChatToolCallBlock,
      made[1] as NativeChatToolResultBlock
    )!.key
    const later = call('Bash', { command })
    expect(cutCreateStandings(rows(made, later)).get(madeKey)?.touched).toBe(true)
  })

  it('counts a create under a home through a command that runs it spelled from ~', () => {
    const made = write('/home/dev/jobs/queue.sh', `${'echo step\n'.repeat(500)}${CUT}`)
    const madeKey = cutCreateOf(
      made[0] as NativeChatToolCallBlock,
      made[1] as NativeChatToolResultBlock
    )!.key
    const later = call('Bash', { command: 'chmod +x ~/jobs/queue.sh && bash ~/jobs/queue.sh' })
    expect(cutCreateStandings(rows(made, later)).get(madeKey)?.touched).toBe(false)
  })

  it('is not touched by an Edit from ~ of a file with the same name at the top of the home', () => {
    const later = call('Edit', {
      file_path: '~/queue-sweep-k-one.sh',
      old_string: 'a',
      new_string: 'b'
    })
    expect(cutCreateStandings(rows(create, later)).get(key)?.touched).toBe(false)
  })

  it('is not touched by an Edit whose `..` leads out of its folder to another file', () => {
    const elsewhere = call('Edit', {
      file_path: PATH.replace('/jobs/queue-sweep-k-one.sh', '/jobs/../queue-sweep-k-one.sh'),
      old_string: 'a',
      new_string: 'b'
    })
    expect(cutCreateStandings(rows(create, elsewhere)).get(key)?.touched).toBe(false)
  })

  it('is touched by a Codex apply_patch that names it', () => {
    const patch = `*** Begin Patch\n*** Update File: ${PATH}\n@@\n-a\n+b\n*** End Patch`
    expect(
      cutCreateStandings(rows(create, call('apply_patch', { input: patch }))).get(key)?.touched
    ).toBe(true)
  })

  it('is touched by a later command that may write the file, by path or by name', () => {
    const byName = call('Bash', {
      command: 'cd hybrid-model/scripts/cluster/jobs && sed -i "" s/a/b/ queue-sweep-k-one.sh'
    })
    // A command that only makes it executable leaves it alone
    // (mobile-native-chat-created-file-commands.test.ts); one that appends
    // to it does not.
    const byPath = call('Bash', { command: `echo '# tuned' >> ${PATH}` })
    expect(cutCreateStandings(rows(create, byName)).get(key)?.touched).toBe(true)
    expect(cutCreateStandings(rows(create, byPath)).get(key)?.touched).toBe(true)
  })

  it('is touched by a later command the wire cut, since the part it dropped may name the file', () => {
    const cutCommand = call('Bash', {
      command: `python3 - <<'EOF'\n${'x = 1\n'.repeat(700)}${CUT}`
    })
    expect(cutCreateStandings(rows(create, cutCommand)).get(key)?.touched).toBe(true)
  })

  it('is not touched by a later read of it, or an edit of another file with the same name', () => {
    const read = call('Read', { file_path: PATH })
    const other = call('Edit', {
      file_path: '/elsewhere/queue-sweep-k-one.sh',
      old_string: 'a',
      new_string: 'b'
    })
    expect(cutCreateStandings(rows(create, read, other)).get(key)?.touched).toBe(false)
  })

  it('is not touched by a command naming files whose names only contain its name', () => {
    const unrelated = call('Bash', {
      command: 'ls my-queue-sweep-k-one.sh queue-sweep-k-one.shell'
    })
    expect(cutCreateStandings(rows(create, unrelated)).get(key)?.touched).toBe(false)
  })

  it('is touched by a command naming its name followed by a dot, which may be the file itself', () => {
    const dotted = call('Bash', {
      command: 'echo "rewrote queue-sweep-k-one.sh." && mv queue-sweep-k-one.sh.new jobs/'
    })
    expect(cutCreateStandings(rows(create, dotted)).get(key)?.touched).toBe(true)
  })

  // Review of 2026-09-26: a subagent's own calls live in its sidechain, not
  // in this transcript, so a prompt that never names the file can still have
  // it edited.
  it.each([
    ['a Claude Task', 'Task'],
    ['a Claude Agent', 'Agent'],
    ['a Codex spawn_agent', 'spawn_agent']
  ])('is touched by %s launched after it, whatever its prompt names', (_, name) => {
    const subagent = call(name, {
      description: 'Tidy job scripts',
      prompt: 'Add set -euo pipefail to every cluster job script',
      subagent_type: 'general-purpose'
    })
    expect(cutCreateStandings(rows(create, subagent)).get(key)?.touched).toBe(true)
  })

  it('is not touched by a command that ran before the create', () => {
    const before = call('Bash', { command: `rm -f ${PATH}` })
    expect(cutCreateStandings(rows(before, create)).get(key)?.touched).toBe(false)
  })

  it('is touched when the same create comes twice, since the second one wrote the file again', () => {
    expect(cutCreateStandings(rows(create, create)).get(key)?.touched).toBe(true)
  })

  it('holds nothing for an empty transcript or one with no cut create', () => {
    expect(cutCreateStandings([]).size).toBe(0)
    expect(cutCreateStandings(rows(write('/w/small.sh', 'echo hi\n'))).size).toBe(0)
  })
})
