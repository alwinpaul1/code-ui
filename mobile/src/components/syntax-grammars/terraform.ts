/*
 * Vendored from @taga3s/highlightjs-terraform 1.0.7 (dist/index.js),
 * https://github.com/taga3s/highlightjs-terraform, based on Nikos
 * Tsirmirakis's highlightjs-terraform.
 *
 * MIT License
 *
 * Copyright (c) 2020 highlightjs-terraform
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Original work: highlight.js terraform syntax highlighting definition
 * @package: highlightjs-terraform
 * @author:  Nikos Tsirmirakis <nikos.tsirmirakis@winopsdba.com>
 * @since:   2019-03-20
 * Description: Terraform (HCL) language definition
 *
 * Changed here: TypeScript, and the definition exported alone (lowlight
 * registers it); the grammar itself is as published.
 */
import type { HLJSApi, Language, Mode } from './hljs-types'

/** https://developer.hashicorp.com/terraform/language/expressions/types#numbers */
const NUMBERS: Mode = {
  className: 'number',
  begin: '\\b\\d+(\\.\\d+)?',
  relevance: 0
}
/** https://developer.hashicorp.com/terraform/language/expressions/types#bool */
const BOOLS: Mode = {
  className: 'literal',
  begin: '\\b(true|false)\\b',
  relevance: 0
}
const FUNCTION_SYMBOL_REGEX_BEGIN = '[A-Za-z_0-9]+\\('
const FUNCTION_SYMBOL_REGEX_END = '\\)'

/**
 * Matches strings with interpolation. This function is recursive and creates
 * a new mode for strings with interpolation up to a specified depth.
 */
function createStringsWithInterpolation(opt: { depth: number }): Mode {
  if (opt.depth < 0) {
    return { contains: [] }
  }
  const strings: Mode = {
    className: 'string',
    begin: '"',
    end: '"',
    contains: [createStringsWithInterpolation({ depth: opt.depth - 1 })]
  }
  const functions: Mode = {
    className: 'meta',
    begin: FUNCTION_SYMBOL_REGEX_BEGIN,
    end: FUNCTION_SYMBOL_REGEX_END,
    contains: [NUMBERS, BOOLS, strings, 'self']
  }
  return {
    className: 'subst',
    begin: '\\${',
    end: '\\}',
    relevance: 9,
    contains: [NUMBERS, BOOLS, strings, functions, 'self']
  }
}

/**
 * https://developer.hashicorp.com/terraform/language/expressions/types#strings
 * https://developer.hashicorp.com/terraform/language/expressions/strings
 */
const STRINGS: Mode = {
  className: 'string',
  begin: '"',
  end: '"',
  contains: [createStringsWithInterpolation({ depth: 2 })]
}
/** https://developer.hashicorp.com/terraform/language/functions */
const FUNCTIONS: Mode = {
  className: 'meta',
  begin: FUNCTION_SYMBOL_REGEX_BEGIN,
  end: FUNCTION_SYMBOL_REGEX_END,
  contains: [NUMBERS, STRINGS, BOOLS, 'self']
}
/**
 * Match following patterns:
 * <BLOCK NAME> {}
 * or
 * <BLOCK NAME> "name" {}
 * or
 * <BLOCK NAME> "name" "name" {}
 */
const BLOCKS: Mode = {
  contains: [
    {
      className: 'keyword',
      // NOTE: highlight.js does not highlight words captured by lookahead assertions.
      begin: '^\\s*\\b[A-Za-z_0-9]*\\b(?=\\s*["\\{])'
    }
  ]
}
const ALIASES = ['tf', 'hcl']

export function hljsDefineTerraform(hljs: HLJSApi): Language {
  return {
    aliases: ALIASES,
    contains: [hljs.COMMENT('\\#', '$'), NUMBERS, BOOLS, STRINGS, FUNCTIONS, BLOCKS]
  }
}
