import type { LanguageFn } from './hljs-types'
import { hljsDefineSolidity } from './solidity'
import { hljsDefineSvelte } from './svelte'
import { hljsDefineTerraform } from './terraform'
import { hljsDefineVue } from './vue'
import { hljsDefineZig } from './zig'

/**
 * Languages highlight.js does not ship, vendored from their own packages
 * (each file carries its licence, source and version). Vue and Svelte embed
 * xml, javascript, typescript, css, scss and stylus by name, which lowlight's
 * full set registers before these.
 */
export const VENDORED_GRAMMARS: Record<string, LanguageFn> = {
  vue: hljsDefineVue,
  svelte: hljsDefineSvelte,
  terraform: hljsDefineTerraform,
  zig: hljsDefineZig,
  solidity: hljsDefineSolidity
}
