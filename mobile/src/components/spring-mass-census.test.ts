import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// 2026-09-27, review of the Background tasks sheet's drag: the sheet shot
// about 31% past full height when it sprang up. Every drawer spring here was
// written as `{ damping: 28, stiffness: 400 }`, a damping ratio of 0.7 at the
// unit mass Reanimated 3 filled in. Reanimated 4 (4.5.1,
// src/animation/spring/spring.ts) merges a config over GentleSpringConfig,
// whose mass is 4, which makes the same numbers a ratio of 0.35. So a spring
// config that names no mass is not the spring its numbers say. The unit tests
// mock withSpring, so nothing played one back; this reads the source, since
// the defect is which default a literal leans on.

const SRC = resolve(import.meta.dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return name === 'node_modules' || name === 'test' ? [] : sourceFiles(path)
    }
    return /\.tsx?$/.test(name) && !/\.(test|generated)\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [path] : []
  })
}

function propertyNames(literal: ts.ObjectLiteralExpression): Set<string> {
  const names = new Set<string>()
  for (const property of literal.properties) {
    const name = property.name
    if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
      names.add(name.text)
    }
  }
  return names
}

/** Lines (1-based) of every object literal in code, not in a comment, that
 *  states a spring by damping and stiffness and leaves its mass to the library. */
function springsWithoutMassIn(source: ts.SourceFile): number[] {
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = propertyNames(node)
      if (names.has('damping') && names.has('stiffness') && !names.has('mass')) {
        lines.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return lines
}

function parse(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
}

describe('springs say their mass, so Reanimated 4 cannot make them bounce', () => {
  it('finds no damping-and-stiffness spring that leaves its mass to the default of 4', () => {
    const found = sourceFiles(SRC).flatMap((path) =>
      springsWithoutMassIn(parse(path, readFileSync(path, 'utf8'))).map((line) => `${relative(SRC, path)}:${line}`)
    )
    expect(found.sort()).toEqual([])
  })

  it('still sees the literal it was written for, and passes one in a comment or with its mass', () => {
    const probe = parse(
      'probe.ts',
      '// { damping: 1, stiffness: 2 } in a comment\nconst a = { damping: 28, stiffness: 400 }\nconst b = { damping: 22, stiffness: 240, mass: 0.6 }'
    )
    expect(springsWithoutMassIn(probe)).toEqual([2])
  })
})
