// The Claude app heads "Created a file, ran a command" with the create's
// count when the command only made the file executable, ran it, read it or
// staged it. The phone voided the count for any command that named the file,
// so the commonest run of all drew no number (review of 2026-09-26). A
// command that may write the file still voids it.

import { describe, expect, it } from 'vitest'
import type {
  NativeChatBlock,
  NativeChatMessage,
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'
import { cutCreateOf, cutCreateStandings } from './mobile-native-chat-created-file-count'
import { CREATED_A_FILE_RUN } from './fixtures/claude-edit-runs-2.1.282'

const WRITE = CREATED_A_FILE_RUN[0] as NativeChatToolCallBlock
const WRITE_RESULT = CREATED_A_FILE_RUN[1] as NativeChatToolResultBlock
const KEY = cutCreateOf(WRITE, WRITE_RESULT)!.key
const PATH = (WRITE.input as { file_path: string }).file_path
const RELATIVE = 'hybrid-model/scripts/cluster/jobs/queue-sweep-k-one.sh'
const NAME = 'queue-sweep-k-one.sh'
const FROM_HOME = PATH.replace('/Users/dev/', '~/')

let nextId = 0

function message(role: 'assistant' | 'user', blocks: NativeChatBlock[]): NativeChatMessage {
  nextId += 1
  return { id: `m-${nextId}`, role, blocks, timestamp: null, source: 'transcript' }
}

const CREATE = [message('assistant', [WRITE]), message('user', [WRITE_RESULT])]

function ranAfter(command: string, tool = 'Bash'): boolean | undefined {
  const run = [
    message('assistant', [{ type: 'tool-call', name: tool, input: { command } }]),
    message('user', [{ type: 'tool-result', output: '' }])
  ]
  return cutCreateStandings([...CREATE, ...run]).get(KEY)?.touched
}

describe('a create followed by a command that names it', () => {
  it.each([
    ['makes it executable', `chmod +x ${PATH}`],
    ['makes it executable and runs it', `chmod +x ${PATH} && ${PATH}`],
    ['runs it from its folder', `cd hybrid-model/scripts/cluster/jobs && ./${NAME}`],
    ['runs it with bash', `bash ${RELATIVE}`],
    ['runs it with sh', `sh ${RELATIVE}`],
    ['runs it with zsh', `zsh ${PATH}`],
    ['runs it with python3', `python3 ${RELATIVE} --dry-run`],
    ['runs it with node', `node ./${RELATIVE}`],
    ['runs it with its errors joined to its output', `bash ${RELATIVE} 2>&1`],
    ['runs it and throws the output away', `bash ${RELATIVE} > /dev/null 2>&1`],
    ['prints it', `cat ${PATH}`],
    ['pages it', `less ${PATH}`],
    ['counts its lines through a pipe', `cat ${PATH} | wc -l`],
    ['reads its head, tail and size', `head -n 20 ${PATH}; tail -n 5 ${PATH}; wc -l ${PATH}`],
    ['looks at it', `ls -l ${RELATIVE} && stat ${RELATIVE} && file ${RELATIVE}`],
    ['stages it', `git add ${RELATIVE}`],
    ['shows how git sees it', `git status --short ${RELATIVE} && git diff ${RELATIVE}`],
    ['reads its history', `git log --oneline -- ${RELATIVE} && git show HEAD:${RELATIVE}`],
    ['quotes its path', `chmod +x "${PATH}" && bash '${RELATIVE}'`],
    ['runs it over a continued line', `chmod +x ${PATH} && \\\n  bash ${RELATIVE}`],
    ['ends in a separator', `chmod +x ${PATH};`],
    ['runs it and prints how it exited', `bash ${RELATIVE}; echo "exit $?"`],
    ['runs it by a path from ~', `chmod +x ${FROM_HOME} && ${FROM_HOME}`]
  ])('counts a create the next command only %s', (_, command) => {
    expect(ranAfter(command)).toBe(false)
  })

  it.each([
    ['appends to it', `echo '# tuned' >> ${PATH}`],
    ['writes over it', `cat /tmp/queue.sh > ${PATH}`],
    ['sends its run to a log', `bash ${RELATIVE} > sweep.log`],
    ['sends its run to a log named like a descriptor', `bash ${RELATIVE} >&2.log`],
    ['sends its errors to a file named like /dev/null', `bash ${RELATIVE} 2>/dev/null.bak`],
    ['tees into it', `bash /tmp/gen.sh | tee ${PATH}`],
    ['edits it in place with sed', `sed -i '' 's/03/3b/' ${PATH}`],
    ['edits it in place with perl', `perl -pi -e 's/03/3b/' ${PATH}`],
    ['moves another file over it', `mv ${PATH}.new ${PATH}`],
    ['copies another file over it', `cp /tmp/queue.sh ${RELATIVE}`],
    ['removes it', `rm ${RELATIVE}`],
    ['makes it executable, then edits it', `chmod +x ${PATH} && sed -i '' 's/a/b/' ${PATH}`],
    ['makes it executable, then checks it out again', `chmod +x ${PATH}; git checkout -- ${PATH}`],
    ['commits it, which runs the hooks', `git add ${RELATIVE} && git commit -m sweep`],
    ['writes a diff over it', `git diff --output=${RELATIVE}`],
    ['hands it to another script', `bash /tmp/tidy.sh ${RELATIVE}`],
    [
      'runs it with a setting that loads another script first',
      `BASH_ENV=./tidy.sh bash ${RELATIVE}`
    ],
    ['sets a variable a later run of it may load', `BASH_ENV=./tidy.sh; bash ${RELATIVE}`],
    ['removes it behind a setting with an escaped space', `X=a\\ cat rm ${RELATIVE}`],
    ['removes it behind a setting with quoted spaces', `X="a "cat" " rm ${RELATIVE}`],
    ['pipes another file through less into it', `cat /tmp/queue.sh | less -O ${PATH}`],
    ['hands it to a script run by path', `./tidy.sh ${RELATIVE}`],
    ['runs it as an inline script', `bash -c "sed -i '' s/a/b/ ${RELATIVE}"`],
    ['runs a bare name the PATH may find elsewhere', `${NAME}`],
    ['reads a substitution that checks it out again', `cat $(git checkout -- ${RELATIVE})`],
    ['reads backticks that remove it', `ls \`rm ${RELATIVE}\``],
    ['reads a process substitution that removes it', `wc -l ${PATH} <(rm ${PATH})`],
    ['lists it through a zsh glob qualifier that runs code', `ls ${RELATIVE}(e:'rm $REPLY':)`],
    ['runs it in a subshell beside a removal', `(bash ${RELATIVE}; rm ${RELATIVE})`],
    ['feeds it through a heredoc', `python3 - <<'EOF'\nopen('${RELATIVE}', 'a').write('x')\nEOF`],
    // Review of 9171bc22 and da87791b: the shell takes the quotes and escapes
    // out of a word before the command sees it, so an option spelled with one
    // still writes.
    [
      'pipes another file through less into it, the option escaped',
      `cat /tmp/queue.sh | less \\-O ${PATH}`
    ],
    [
      'pipes another file through less into it, the option quoted onto the path',
      `cat /tmp/queue.sh | less '-O'${PATH}`
    ],
    [
      'pipes another file through less into it, the option behind an empty quote',
      `cat /tmp/queue.sh | less ""-O ${PATH}`
    ],
    [
      'pipes another file through less into it, the option in a brace list',
      `cat /tmp/queue.sh | less {-O,${PATH}}`
    ],
    [
      'pipes another file through less into it, the option in a variable',
      `cat /tmp/queue.sh | less $OPT ${PATH}`
    ],
    ['writes a diff over it, the option half quoted', `git diff --"output"=${RELATIVE}`],
    ['writes a diff over it, the option escaped', `git diff \\--output=${RELATIVE}`],
    ['writes a diff over it, the option quoted', `git diff '--output'=${RELATIVE}`],
    ['writes a diff over it, the option in a variable', `git diff $OUT ${RELATIVE}`],
    // A quoted `~` is not expanded, so these run a script under a folder named `~`.
    ['runs a script of its name from a quoted ~', `bash "${FROM_HOME}"`],
    ['runs a script of its name by a quoted path from ~', `'${FROM_HOME}'`]
  ])('draws no count for a create the next command %s', (_, command) => {
    expect(ranAfter(command)).toBe(true)
  })

  // A create spelled from ~ names no home, so a path under any folder that
  // ends in its own is read as it, and a variable can name any folder.
  it.each([
    ['runs a script of its name under a folder a variable names', 'bash $DIR/'],
    ['is a script of its name under a folder a variable names', '$DIR/']
  ])('draws no count for a create spelled from ~ when the next command %s', (_, lead) => {
    const write: NativeChatToolCallBlock = {
      ...WRITE,
      input: { ...(WRITE.input as object), file_path: FROM_HOME }
    }
    const result: NativeChatToolResultBlock = {
      type: 'tool-result',
      output: `File created successfully at: ${FROM_HOME}`
    }
    const run = message('assistant', [
      { type: 'tool-call', name: 'Bash', input: { command: `${lead}${FROM_HOME.slice(2)}` } }
    ])
    const create = [message('assistant', [write]), message('user', [result])]
    const standing = cutCreateStandings([...create, run]).get(cutCreateOf(write, result)!.key)
    expect(standing?.touched).toBe(true)
  })

  it('draws no count for a PowerShell echo whose bracketed argument removes it', () => {
    expect(ranAfter(`echo (Remove-Item ${RELATIVE})`, 'PowerShell')).toBe(true)
  })

  it("counts a create after the user's own ! command that only runs it", () => {
    const run = [
      message('user', [{ type: 'text', text: `<bash-input>bash ${RELATIVE}</bash-input>` }]),
      message('user', [
        { type: 'text', text: '<bash-stdout>swept</bash-stdout><bash-stderr></bash-stderr>' }
      ])
    ]
    expect(cutCreateStandings([...CREATE, ...run]).get(KEY)?.touched).toBe(false)
  })

  it('draws no count for a command with no string to read, such as a Codex argument list', () => {
    const argv = message('assistant', [
      { type: 'tool-call', name: 'shell', input: { command: ['bash', '-lc', `chmod +x ${PATH}`] } }
    ])
    expect(cutCreateStandings([...CREATE, argv]).get(KEY)?.touched).toBe(true)
  })
})
