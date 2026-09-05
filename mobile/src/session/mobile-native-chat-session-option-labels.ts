// Mobile port of desktop's pill labeling
// (src/renderer/src/components/native-chat/native-chat-session-option-labels.ts),
// minus i18n — mobile renders plain strings throughout.

import type {
  SessionOptionDescriptor,
  SessionOptionDisabledReason,
  SessionOptionSelectChoice
} from '../../../src/shared/native-chat-session-options'

export function mobileSessionOptionDisabledReason(
  reason: SessionOptionDisabledReason | undefined
): string | null {
  // Exhaustive over SessionOptionDisabledReason so new keys are a compile error.
  switch (reason) {
    case 'set-when-session-starts':
      return 'Set when the session starts.'
    case 'available-after-session-start':
      return 'Available after the session starts.'
    case undefined:
      return null
  }
}

function selectedChoiceLabel(descriptor: SessionOptionDescriptor): string | null {
  if (
    descriptor.valueSource === 'unknown' ||
    descriptor.kind.type !== 'select' ||
    !descriptor.kind.currentValue
  ) {
    return null
  }
  const current = descriptor.kind.currentValue
  const choice: SessionOptionSelectChoice = descriptor.kind.choices.find(
    (candidate) => candidate.value === current
  ) ?? { value: current, label: current }
  return choice.label
}

/** Value-only pill text — the category lives on the sheet title, not the pill. */
export function mobileModelPillLabel(descriptor: SessionOptionDescriptor): string {
  return selectedChoiceLabel(descriptor) ?? 'Model'
}

export function mobileSessionOptionSummaryValue(descriptor: SessionOptionDescriptor): string {
  if (descriptor.valueSource === 'unknown') {
    return 'Not set'
  }
  if (descriptor.kind.type === 'select') {
    return selectedChoiceLabel(descriptor) ?? 'Not set'
  }
  return descriptor.kind.currentValue === undefined
    ? 'Not set'
    : descriptor.kind.currentValue
      ? 'On'
      : 'Off'
}

export function mobileOptionsPillLabel(descriptors: readonly SessionOptionDescriptor[]): string {
  const labels: string[] = []
  for (const descriptor of descriptors) {
    if (descriptor.valueSource === 'unknown') {
      continue
    }
    if (descriptor.kind.type === 'select') {
      const label = selectedChoiceLabel(descriptor)
      if (label) {
        labels.push(label)
      }
    } else if (descriptor.kind.currentValue === true) {
      labels.push(descriptor.id === 'fastMode' ? 'Fast' : descriptor.label)
    }
  }
  // Why: with nothing known the pill used to read "Sonnet Effort" — the effort
  // descriptor's title standing in for a value. An empty string lets the pill
  // show the model alone; the sheet still lists effort for the user to set.
  return labels.join(' · ')
}
