// Why: react-native-svg's entry is TypeScript/Flow the Node test runtime
// cannot parse. Every element the app uses becomes a host tag here; a test
// that needs its own shape can still vi.mock the module (local wins).
import { createElement, type ReactNode } from 'react'

function tag(name: string) {
  return (props: Record<string, unknown> & { children?: ReactNode }) => createElement(name, props)
}

const Svg = tag('Svg')
export default Svg
export const SvgXml = tag('SvgXml')
export const SvgUri = tag('SvgUri')
export const Path = tag('Path')
export const G = tag('G')
export const Defs = tag('Defs')
export const LinearGradient = tag('LinearGradient')
export const Stop = tag('Stop')
export const Rect = tag('Rect')
export const Circle = tag('Circle')
export const Line = tag('Line')
export const Text = tag('SvgText')
