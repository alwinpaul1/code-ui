import { describe, expect, it } from 'vitest'
import { detectMobileFileLanguage, isUnknownMobileFileName } from './mobile-file-language'
import {
  canHighlightMobileLanguage,
  detectMobileSyntaxLanguage,
  highlightMobileCode,
  resolveMobileSyntaxLanguage,
  resolveMobileSyntaxLanguageForContent
} from './mobile-file-syntax'
import {
  RNSVG_PAPER_IDL,
  STREAM_BUFFERS_LCOV_INFO,
  TOKENIZE_UTIL_JS_FLOW
} from './mobile-syntax-detect-samples.test-support'

/** The kinds a file's code is drawn in, as the code viewer colours it. */
function kindsOf(code: string, language: string): Set<string> {
  const result = highlightMobileCode(code, language, Infinity, Infinity)
  expect(result.highlighted, `${language} highlighted`).toBe(true)
  return new Set(result.segments.map((segment) => segment.kind))
}

function expectKeywordAndComment(path: string, code: string): void {
  const language = resolveMobileSyntaxLanguage(path)
  expect(language, path).not.toBe('plaintext')
  const kinds = kindsOf(code, language)
  expect(kinds.has('keyword') || kinds.has('control'), `${path}: a keyword is coloured`).toBe(true)
  expect(kinds.has('comment'), `${path}: a comment is coloured`).toBe(true)
}

// Real-world shapes: a thesis preamble, a Node image, a GenServer, a Cargo
// manifest (TOML reads through ini), and so on.
const HIGHLIGHT_JS_SNIPPETS: Record<string, string> = {
  'thesis/main.tex':
    '\\documentclass[a4paper,12pt]{report}\n% Thesis preamble\n\\usepackage{amsmath}\n\\begin{document}\n\\chapter{Introduction}\n\\end{document}\n',
  Dockerfile:
    '# syntax=docker/dockerfile:1\nFROM node:22-alpine AS build\nWORKDIR /app\nCOPY package.json ./\nRUN npm ci\n',
  'lib/counter.ex':
    'defmodule Counter do\n  # Keeps a count in a process.\n  use GenServer\n\n  def init(count), do: {:ok, count}\nend\n',
  'app/Main.hs': '-- | Sum a list.\nmodule Main where\n\nmain :: IO ()\nmain = print (foldr (+) 0 [1, 2, 3])\n',
  'src/Main.scala':
    'object Main extends App {\n  // Print the squares.\n  val squares = (1 to 5).map(n => n * n)\n  println(squares)\n}\n',
  'lib/main.dart': 'import "package:flutter/material.dart";\n\n// Entry point.\nvoid main() {\n  runApp(const MyApp());\n}\n',
  'scripts/clean.ps1':
    '# Remove old builds.\nfunction Clear-Builds {\n  param([string]$Path)\n  Get-ChildItem $Path | Remove-Item -Recurse\n}\n',
  'shell.nix':
    '# Development shell.\nlet\n  pkgs = import <nixpkgs> {};\nin\npkgs.mkShell {\n  buildInputs = [ pkgs.nodejs ];\n}\n',
  'src/stats.jl': '# Mean of a vector.\nfunction mymean(xs::Vector{Float64})\n    return sum(xs) / length(xs)\nend\n',
  'proto/session.proto':
    'syntax = "proto3";\n// A session.\nmessage Session {\n  string id = 1;\n  repeated string tabs = 2;\n}\n',
  'CMakeLists.txt':
    'cmake_minimum_required(VERSION 3.20)\n# The app.\nproject(orca LANGUAGES CXX)\nadd_executable(orca main.cpp)\n',
  'Cargo.toml':
    '# Cargo manifest\n[package]\nname = "orca"\nversion = "0.1.0"\n\n[dependencies]\nserde = { version = "1", features = ["derive"] }\n'
}

// The five highlight.js does not ship, vendored in components/syntax-grammars/.
const VENDORED_SNIPPETS: Record<string, string> = {
  'src/Counter.vue':
    '<template>\n  <!-- The counter. -->\n  <button @click="count++">{{ count }}</button>\n</template>\n\n<script>\nexport default {\n  data() {\n    return { count: 0 }\n  }\n}\n</script>\n',
  'src/Counter.svelte':
    '<script>\n  // The count.\n  let count = 0\n</script>\n\n<!-- The button. -->\n{#if count > 0}\n  <p>{count}</p>\n{/if}\n<button on:click={() => count++}>+</button>\n',
  'infra/main.tf':
    '# The bucket for build artefacts.\nresource "aws_s3_bucket" "artefacts" {\n  bucket = "orca-artefacts"\n  tags = {\n    env = "prod"\n  }\n}\n',
  'src/main.zig':
    'const std = @import("std");\n\n// Print a greeting.\npub fn main() !void {\n    const stdout = std.io.getStdOut().writer();\n    try stdout.print("hi\\n", .{});\n}\n',
  'contracts/Counter.sol':
    '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\ncontract Counter {\n    uint256 public count;\n    function increment() public {\n        count += 1;\n    }\n}\n'
}

describe('code in languages past highlight.js\'s common set is coloured, not drawn plain', () => {
  it.each(Object.entries(HIGHLIGHT_JS_SNIPPETS))('%s', (path, code) => {
    expectKeywordAndComment(path, code)
  })
})

describe('Vue, Svelte, Terraform, Zig and Solidity are coloured by their vendored grammars', () => {
  it.each(Object.entries(VENDORED_SNIPPETS))('%s', (path, code) => {
    expectKeywordAndComment(path, code)
  })

  it('reads the grammars\' aliases too, as a fenced block names them', () => {
    for (const alias of ['hcl', 'tf', 'sol']) {
      expect(canHighlightMobileLanguage(alias), alias).toBe(true)
    }
    expect(resolveMobileSyntaxLanguage('', 'hcl')).toBe('hcl')
  })
})

describe('the file names and extensions the viewer knows', () => {
  it.each([
    ['thesis/chapters/intro.tex', 'latex'],
    ['thesis/uni.sty', 'latex'],
    ['thesis/thesis.cls', 'latex'],
    ['Dockerfile', 'dockerfile'],
    ['docker/Dockerfile.dev', 'dockerfile'],
    ['Containerfile', 'dockerfile'],
    ['CMakeLists.txt', 'cmake'],
    ['android/app/build.gradle', 'gradle'],
    ['proto/session.proto', 'protobuf'],
    ['lib/app.ex', 'elixir'],
    ['test/app_test.exs', 'elixir'],
    ['src/Main.hs', 'haskell'],
    ['src/Main.scala', 'scala'],
    ['lib/main.dart', 'dart'],
    ['scripts/clean.ps1', 'powershell'],
    ['flake.nix', 'nix'],
    ['src/stats.jl', 'julia'],
    ['src/parser.ml', 'ocaml'],
    ['src/Program.fs', 'fsharp'],
    ['src/server.erl', 'erlang'],
    ['src/core.clj', 'clojure'],
    ['src/main.nim', 'nim'],
    ['src/app.cr', 'crystal'],
    ['Cargo.toml', 'ini'],
    ['src/App.vue', 'vue'],
    ['src/App.svelte', 'svelte'],
    ['infra/main.tf', 'terraform'],
    ['infra/prod.tfvars', 'terraform'],
    ['infra/policy.hcl', 'terraform'],
    ['src/main.zig', 'zig'],
    ['contracts/Token.sol', 'solidity'],
    ['Gemfile', 'ruby'],
    ['Jenkinsfile', 'groovy']
  ])('%s is %s, and the highlighter has it', (path, language) => {
    expect(detectMobileFileLanguage(path)).toBe(language)
    expect(resolveMobileSyntaxLanguage(path)).toBe(language)
  })

  it('knows plain text by name, and does not know a name it has no entry for', () => {
    for (const path of ['notes.txt', 'server.log', 'LICENSE', 'data/scores.csv']) {
      expect(isUnknownMobileFileName(path), path).toBe(false)
      expect(resolveMobileSyntaxLanguage(path), path).toBe('plaintext')
    }
    for (const path of ['bin/deploy', 'run.xyz', 'analysis/smooth.m', 'constructor', 'toString']) {
      expect(isUnknownMobileFileName(path), path).toBe(true)
    }
  })
})

const DEPLOY_SCRIPT = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  '',
  '# Build the release APK and copy it next to the repo.',
  'cd "$(dirname "$0")/.."',
  'for abi in arm64-v8a x86_64; do',
  '  ./gradlew assembleRelease -PreactNativeArchitectures="$abi"',
  'done',
  ''
].join('\n')

const RELEASE_WORKFLOW = [
  'name: Release',
  'on:',
  '  push:',
  '    tags:',
  "      - 'mobile-android-v*'",
  'jobs:',
  '  release:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - uses: actions/setup-node@v4',
  '        with:',
  '          node-version: 22',
  '      - run: pnpm install --frozen-lockfile',
  '      - run: npx tsc --noEmit && npx vitest run',
  '      - name: Build the APK',
  '        run: ./gradlew assembleRelease',
  '        working-directory: mobile/android',
  ''
].join('\n')

const README = [
  'Code UI is the phone companion for Orca. The desktop stays the source of truth,',
  'and the phone shows its sessions, files and terminals over an encrypted relay.',
  '',
  'To try it, install the APK from the latest release, open Orca on the desktop, and',
  'scan the pairing code it shows. Nothing needs to be set up on the desktop itself.',
  ''
].join('\n')

describe('a file whose name says nothing is read for its language', () => {
  it('colours a script by its #! line', () => {
    expect(resolveMobileSyntaxLanguageForContent('bin/deploy', DEPLOY_SCRIPT)).toBe('bash')
    expect(
      resolveMobileSyntaxLanguageForContent('tools/rotate', '#!/usr/bin/python3.11\nimport sys\nprint(sys.argv)\n')
    ).toBe('python')
    expect(resolveMobileSyntaxLanguageForContent('tools/serve', '#!/usr/bin/env -S deno run\nconsole.log(1)\n')).toBe(
      'typescript'
    )
  })

  it('colours JSON and XML by their shape', () => {
    expect(resolveMobileSyntaxLanguageForContent('data/settings', '{\n  "theme": "dark",\n  "wrap": false\n}\n')).toBe(
      'json'
    )
    expect(resolveMobileSyntaxLanguageForContent('res/layout.view', '<?xml version="1.0"?>\n<layout/>\n')).toBe('xml')
  })

  it('tells an Objective-C .m from a MATLAB one', () => {
    const objc = '#import <Foundation/Foundation.h>\n\n@implementation Greeter\n- (void)greet {}\n@end\n'
    const matlab = 'function y = smooth_signal(x, k)\n% SMOOTH_SIGNAL moving average of x\n  y = movmean(x, k);\nend\n'
    expect(resolveMobileSyntaxLanguageForContent('src/Greeter.m', objc)).toBe('objectivec')
    expect(resolveMobileSyntaxLanguageForContent('analysis/smooth_signal.m', matlab)).toBe('matlab')
  })

  it('does not guess from highlight.js\'s relevance, even for a CI workflow saved without an extension', () => {
    // Relevance was no evidence (review, 2026-09-27): it called real files
    // the wrong language with more confidence (lcov.info: Makefile, 301 and
    // 4x the runner-up) than this workflow's right answer (YAML, 138, 1.8x).
    expect(resolveMobileSyntaxLanguageForContent('ci/release-workflow', RELEASE_WORKFLOW)).toBe('plaintext')
  })

  it('stays plain on prose and log lines, where highlight.js only guesses', () => {
    expect(resolveMobileSyntaxLanguageForContent('docs/ABOUT', README)).toBe('plaintext')
    const log = '2026-09-26 22:53:19 INFO  relay connected in 250 ms\n2026-09-26 22:53:21 ERROR session 4f46 closed: EOF\n'
    expect(resolveMobileSyntaxLanguageForContent('logs/relay.1', log.repeat(20))).toBe('plaintext')
  })

  it('stays plain on an empty file, and on a script whose interpreter it does not know', () => {
    expect(detectMobileSyntaxLanguage('')).toBeNull()
    expect(detectMobileSyntaxLanguage('\n\n  \n')).toBeNull()
    expect(detectMobileSyntaxLanguage('#!/usr/bin/env frobnicate\nfrob all\n')).toBeNull()
    expect(detectMobileSyntaxLanguage('#!/usr/bin/env constructor\n')).toBeNull()
  })

  it('does not second-guess a file its name already places', () => {
    // A .txt stays text, whatever it holds; a .py stays Python.
    expect(resolveMobileSyntaxLanguageForContent('notes.txt', DEPLOY_SCRIPT)).toBe('plaintext')
    expect(resolveMobileSyntaxLanguageForContent('scripts/tool.py', DEPLOY_SCRIPT)).toBe('python')
    // And a language the caller names wins over the content.
    expect(resolveMobileSyntaxLanguageForContent('bin/deploy', DEPLOY_SCRIPT, 'ruby')).toBe('ruby')
  })
})

describe('a file its name does not place stays plain unless the text itself says what it is', () => {
  it('leaves a coverage report, an IDL file and short notes plain, which highlight.js took for code', () => {
    expect(resolveMobileSyntaxLanguageForContent('coverage/lcov.info', STREAM_BUFFERS_LCOV_INFO)).toBe('plaintext')
    expect(resolveMobileSyntaxLanguageForContent('windows/RNSVG/Paper.idl', RNSVG_PAPER_IDL)).toBe('plaintext')
    // 173 characters of notes: highlight.js called them SQL, 16 against 4.
    const notes = 'Ship list\n\n- make the explorer copy whole files\n- fold long functions like the desktop\n- check the Hermes timing on the phone\n- ask about wrap on tablets\n'
    expect(resolveMobileSyntaxLanguageForContent('docs/ship-list', notes)).toBe('plaintext')
  })

  it('knows the plain-text files every project keeps by name', () => {
    const prose = 'Changes since 0.5.3: the reader folds and copies; see the release notes.\n'
    for (const name of ['TODO', 'NOTES', 'CHANGES', 'HISTORY', 'NEWS', 'INSTALL', 'THANKS', 'MAINTAINERS', 'VERSION']) {
      expect(isUnknownMobileFileName(name), name).toBe(false)
      expect(resolveMobileSyntaxLanguageForContent(name, prose), name).toBe('plaintext')
    }
  })

  it('reads a Flow file as JavaScript and an Astro page as HTML, by name', () => {
    expect(resolveMobileSyntaxLanguageForContent('fbjs/lib/TokenizeUtil.js.flow', TOKENIZE_UTIL_JS_FLOW)).toBe('javascript')
    const astro = '---\nimport Header from "../components/Header.astro";\nconst title = "Home";\n---\n<html lang="en">\n  <body><Header title={title} /></body>\n</html>\n'
    expect(resolveMobileSyntaxLanguageForContent('src/pages/index.astro', astro)).toBe('xml')
  })
})
