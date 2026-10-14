import { describe, expect, it } from 'vitest'
import {
  approveWithheldReason,
  isDestructiveToolRequest,
  toolNameOfPermission
} from './permission-notification-approve-gate'

const ESCAPE = String.fromCharCode(27)

function permission(title: string, command?: string) {
  return {
    title,
    ...(command === undefined ? {} : { command }),
    options: [
      { label: 'Allow', send: '1' },
      { label: 'Deny', send: ESCAPE }
    ]
  }
}

// The Claude Android app builds a permission notification's actions in i09.java: Approve only when
// `c(tool)` holds, which is false for no tool name, for AskUserQuestion and ExitPlanMode (i09.a,
// the set that reads "needs the app"), and for the tools in r45.b: place_call, delete_project,
// start_routine, delete_project_file. Approve is then not drawn at all (or, for the r45.b tools,
// drawn to open the app). Those tools are Anthropic's own; the same idea here is a request that
// should not be one tap in the shade: a plan to approve, a question to answer, a tool or a shell
// command that deletes or cannot be undone.

describe('naming the tool a permission asks about', () => {
  it('reads it off the title the approval envelope gives', () => {
    expect(toolNameOfPermission({ title: 'Allow Bash?' })).toBe('Bash')
    expect(toolNameOfPermission({ title: 'Allow mcp__github__delete_branch?' })).toBe('mcp__github__delete_branch')
  })

  it('reads none off a title that is not "Allow <tool>?"', () => {
    expect(toolNameOfPermission({ title: 'Permission requested' })).toBeNull()
    expect(toolNameOfPermission({ title: 'Allow ?' })).toBeNull()
    expect(toolNameOfPermission({ title: '' })).toBeNull()
  })
})

describe('the requests Approve is withheld from', () => {
  it('withholds it from a plan to approve (ExitPlanMode)', () => {
    expect(approveWithheldReason(permission('Allow ExitPlanMode?'))).toBe('plan')
  })

  it('withholds it from a question to answer (AskUserQuestion)', () => {
    expect(approveWithheldReason(permission('Allow AskUserQuestion?'))).toBe('question')
  })

  it('withholds it when the tool is not known, as the Claude app does', () => {
    expect(approveWithheldReason(permission('Permission requested'))).toBe('unknown-tool')
  })

  it.each([
    ['rm -rf build'],
    ['rm file.txt'],
    ['sudo systemctl restart nginx'],
    ['git push --force origin main'],
    ['git push -f'],
    ['git push origin main --force-with-lease'],
    ['git reset --hard HEAD~3'],
    ['git clean -fd'],
    ['git branch -D feature'],
    ['git checkout -- .'],
    ['find . -name "*.log" -delete'],
    ['cat list | xargs rm'],
    ['ls && rm -r dist'],
    ['dd if=/dev/zero of=/dev/disk2'],
    ['chmod -R 777 /'],
    ['kill -9 1234'],
    ['pkill node'],
    ['psql -c "DROP TABLE users"'],
    ['mysql -e "delete from orders"'],
    ['docker system prune -af'],
    ['kubectl delete pod web-0'],
    ['terraform destroy -auto-approve'],
    ['gh repo delete acme/app --yes'],
    ['npm publish']
  ])('withholds it from the Bash command %s', (command) => {
    expect(approveWithheldReason(permission('Allow Bash?', command))).toBe('destructive')
  })

  it.each([
    ['mcp__hearthbot__delete_project'],
    ['mcp__hearthbot__place_call'],
    ['mcp__hearthbot__start_routine'],
    ['mcp__hearthbot__delete_project_file'],
    ['mcp__github__delete_branch'],
    ['mcp__db__drop_table'],
    ['mcp__files__remove_file']
  ])('withholds it from the tool %s', (tool) => {
    expect(approveWithheldReason(permission(`Allow ${tool}?`))).toBe('destructive')
  })

  it('also reads the command from the summary when the permission has no command', () => {
    expect(
      approveWithheldReason({ title: 'Allow Bash?', detail: 'rm -rf build', options: [{ label: 'Allow', send: '1' }] })
    ).toBe('destructive')
  })
})

describe('the requests Approve is kept for', () => {
  it.each([
    ['ls -la'],
    ['git status'],
    ['git log --oneline -5'],
    ['git push origin main'],
    ['npm test'],
    ['pnpm exec vitest run'],
    ['npm run format'],
    ['pdflatex -interaction=nonstopmode cv.tex'],
    ['touch /tmp/cuicap-probe-b4.txt'],
    ['grep -rn "rm" src'],
    ['echo firm'],
    ['./rm-helper.sh --dry-run'],
    ['cat README.md | head -20'],
    ['Recompile and re-render page 2']
  ])('keeps it for the Bash command %s', (command) => {
    expect(approveWithheldReason(permission('Allow Bash?', command))).toBeNull()
  })

  it.each(['Edit', 'Write', 'Read', 'WebFetch', 'mcp__github__list_issues', 'mcp__db__read_table'])(
    'keeps it for the tool %s',
    (tool) => {
      expect(approveWithheldReason(permission(`Allow ${tool}?`))).toBeNull()
    }
  )

  it('keeps it for a Bash request with no command to read (it cannot be shown to be destructive)', () => {
    expect(approveWithheldReason(permission('Allow Bash?'))).toBeNull()
  })
})

describe('telling a destructive request apart', () => {
  it('is false for no command and no tool of that kind', () => {
    expect(isDestructiveToolRequest('Edit', undefined)).toBe(false)
    expect(isDestructiveToolRequest('Bash', '')).toBe(false)
  })

  it('does not read a command of a tool that is not a shell', () => {
    expect(isDestructiveToolRequest('Edit', 'rm -rf build')).toBe(false)
  })
})
