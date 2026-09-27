function extname(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.')
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  if (lastDot <= lastSlash) {
    return ''
  }
  return filePath.slice(lastDot)
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.cts': 'typescript',
  '.mts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.jsonc': 'json',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.htm': 'html',
  '.xml': 'xml',
  '.svg': 'xml',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
  '.ps1': 'powershell',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.lua': 'lua',
  '.r': 'r',
  '.R': 'r',
  '.make': 'makefile',
  '.mk': 'makefile',
  '.mak': 'makefile',
  // Beyond highlight.js's common set (2026-09-26: a .tex thesis drew plain).
  // .cls, .fs, .v, .d, .m name several languages each (a LaTeX class or
  // Apex, GLSL or F#, Verilog or Coq, a make dependency file or D, MATLAB or
  // Objective-C): not here; mobile-file-syntax reads the file's own marks.
  '.tex': 'latex',
  '.sty': 'latex',
  '.ltx': 'latex',
  '.dtx': 'latex',
  '.dockerfile': 'dockerfile',
  '.cmake': 'cmake',
  '.gradle': 'gradle',
  '.groovy': 'groovy',
  '.gvy': 'groovy',
  '.proto': 'protobuf',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.hs': 'haskell',
  '.lhs': 'haskell',
  '.scala': 'scala',
  '.sc': 'scala',
  '.sbt': 'scala',
  '.dart': 'dart',
  '.psm1': 'powershell',
  '.psd1': 'powershell',
  '.nix': 'nix',
  '.jl': 'julia',
  '.ml': 'ocaml',
  '.mli': 'ocaml',
  '.fsi': 'fsharp',
  '.fsx': 'fsharp',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.cljc': 'clojure',
  '.edn': 'clojure',
  '.nim': 'nim',
  '.nims': 'nim',
  '.cr': 'crystal',
  '.mm': 'objectivec',
  '.pl': 'perl',
  '.pm': 'perl',
  '.bat': 'dos',
  '.cmd': 'dos',
  '.vim': 'vim',
  '.f': 'fortran',
  '.for': 'fortran',
  '.f90': 'fortran',
  '.f95': 'fortran',
  '.f03': 'fortran',
  '.properties': 'properties',
  '.coffee': 'coffeescript',
  '.elm': 'elm',
  '.erb': 'erb',
  '.hbs': 'handlebars',
  '.handlebars': 'handlebars',
  '.twig': 'twig',
  '.haml': 'haml',
  '.styl': 'stylus',
  '.sass': 'scss',
  '.vb': 'vbnet',
  '.vbs': 'vbscript',
  '.ino': 'arduino',
  '.asm': 'x86asm',
  '.sv': 'verilog',
  '.vhd': 'vhdl',
  '.vhdl': 'vhdl',
  '.tcl': 'tcl',
  '.lisp': 'lisp',
  '.el': 'lisp',
  '.scm': 'scheme',
  '.rkt': 'scheme',
  '.pas': 'delphi',
  '.dpr': 'delphi',
  '.ada': 'ada',
  '.adb': 'ada',
  '.ads': 'ada',
  '.diff': 'diff',
  '.patch': 'diff',
  '.http': 'http',
  '.awk': 'awk',
  '.ll': 'llvm',
  '.wat': 'wasm',
  '.wast': 'wasm',
  '.thrift': 'thrift',
  '.hx': 'haxe',
  '.bzl': 'python',
  '.jsonl': 'json',
  '.json5': 'json',
  '.ipynb': 'json',
  '.pyi': 'python',
  // Starlark: BUILD.bazel, MODULE.bazel, WORKSPACE.bazel.
  '.bazel': 'python',
  '.gemspec': 'ruby',
  '.rake': 'ruby',
  '.podspec': 'ruby',
  '.ru': 'ruby',
  '.markdown': 'markdown',
  // Cursor's rule files: Markdown under front matter.
  '.mdc': 'markdown',
  '.cu': 'cpp',
  '.cuh': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',
  // `name.js.flow`: a Flow declaration file, JavaScript with types.
  '.flow': 'javascript',
  // Front matter, then HTML with components in it.
  '.astro': 'xml',
  '.xaml': 'xml',
  '.plist': 'xml',
  '.csproj': 'xml',
  '.xsd': 'xml',
  '.xsl': 'xml',
  // Not in highlight.js; vendored in components/syntax-grammars/.
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.tf': 'terraform',
  '.tfvars': 'terraform',
  '.hcl': 'terraform',
  '.zig': 'zig',
  '.sol': 'solidity',
  // Text: known, and plain, so the content is not read for a language.
  '.txt': 'plaintext',
  '.text': 'plaintext',
  '.log': 'plaintext',
  '.csv': 'plaintext',
  '.tsv': 'plaintext',
  '.out': 'plaintext'
}

const FILENAME_TO_LANGUAGE: Record<string, string> = {
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
  'CMakeLists.txt': 'cmake',
  '.gitignore': 'ini',
  '.gitattributes': 'ini',
  '.editorconfig': 'ini',
  '.npmrc': 'ini',
  '.gitconfig': 'ini',
  '.gitmodules': 'ini',
  '.dockerignore': 'ini',
  '.npmignore': 'ini',
  Containerfile: 'dockerfile',
  GNUmakefile: 'makefile',
  makefile: 'makefile',
  Gemfile: 'ruby',
  Rakefile: 'ruby',
  Podfile: 'ruby',
  Fastfile: 'ruby',
  Appfile: 'ruby',
  Vagrantfile: 'ruby',
  Brewfile: 'ruby',
  Jenkinsfile: 'groovy',
  BUILD: 'python',
  'BUILD.bazel': 'python',
  WORKSPACE: 'python',
  '.envrc': 'bash',
  '.zshenv': 'bash',
  '.bash_aliases': 'bash',
  PKGBUILD: 'bash',
  '.bazelrc': 'bash',
  // TOML, which highlight.js reads as ini.
  'Cargo.lock': 'ini',
  'uv.lock': 'ini',
  'poetry.lock': 'ini',
  Pipfile: 'ini',
  'Podfile.lock': 'yaml',
  Tiltfile: 'python',
  '.bashrc': 'bash',
  '.bash_profile': 'bash',
  '.zshrc': 'bash',
  '.zprofile': 'bash',
  '.profile': 'bash',
  '.vimrc': 'vim',
  'nginx.conf': 'nginx',
  '.htaccess': 'apache',
  'httpd.conf': 'apache',
  LICENSE: 'plaintext',
  LICENCE: 'plaintext',
  COPYING: 'plaintext',
  NOTICE: 'plaintext',
  AUTHORS: 'plaintext',
  CONTRIBUTORS: 'plaintext',
  CHANGELOG: 'plaintext',
  CHANGES: 'plaintext',
  HISTORY: 'plaintext',
  NEWS: 'plaintext',
  TODO: 'plaintext',
  NOTES: 'plaintext',
  INSTALL: 'plaintext',
  THANKS: 'plaintext',
  CREDITS: 'plaintext',
  MAINTAINERS: 'plaintext',
  PATENTS: 'plaintext',
  VERSION: 'plaintext',
  README: 'plaintext'
}

/** `Dockerfile.dev`, `dockerfile`, `Containerfile.base`: a Dockerfile by
 *  its prefix, in either case. */
const DOCKERFILE_NAME = /^(?:dockerfile|containerfile)(?:\.|$)/i
/** `.env`, `.env.local`, `.env.staging`: dotenv files, by their prefix
 *  (`.envrc` is a shell script, and not one of them). */
const DOTENV_NAME = /^\.env(?:\.|$)/

/** An own entry only: a file named `constructor` is not Object's. */
function lookUp(map: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined
}

/** A name first, then a known extension, and only then the Dockerfile and
 *  dotenv name rules: `dockerfile.js` (highlight.js's own grammar for it)
 *  and `.env.json` are what their extensions say (review, 2026-09-27). */
function languageFromName(filename: string): string | undefined {
  return (
    lookUp(FILENAME_TO_LANGUAGE, filename) ??
    lookUp(EXT_TO_LANGUAGE, extname(filename).toLowerCase()) ??
    (DOCKERFILE_NAME.test(filename) ? 'dockerfile' : undefined) ??
    (DOTENV_NAME.test(filename) ? 'ini' : undefined)
  )
}

function fileNameOf(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath
}

/** Whether a file's name says nothing about its language: no known name and
 *  no known extension. Such a file's text is read for what it declares
 *  (a `#!` line, a JSON or XML shape) instead. */
export function isUnknownMobileFileName(filePath: string): boolean {
  return languageFromName(fileNameOf(filePath)) === undefined
}

export function detectMobileFileLanguage(filePath: string, preferredLanguage?: string): string {
  const normalizedPreferred = preferredLanguage?.trim().toLowerCase()
  if (normalizedPreferred && normalizedPreferred !== 'plaintext') {
    return normalizedPreferred
  }

  return languageFromName(fileNameOf(filePath)) ?? 'plaintext'
}
