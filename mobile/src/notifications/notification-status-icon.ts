/**
 * The drawn icons a notification carries where it once had an emoji (the user,
 * 2026-09-24: "the emojis place must be replaced with nice svgs"). Each value
 * is an Android drawable that plugins/android-notification-status-icons.js
 * builds from `assets/notification-icons/<kind>.svg`; the expo-notifications
 * patch reads `data.statusIcon` and draws it in the title row.
 */
export const NOTIFICATION_STATUS_ICONS = {
  done: 'notification_status_done',
  question: 'notification_status_question',
  bell: 'notification_status_bell',
  warning: 'notification_status_warning'
} as const

export type NotificationStatusIcon = (typeof NOTIFICATION_STATUS_ICONS)[keyof typeof NOTIFICATION_STATUS_ICONS]
