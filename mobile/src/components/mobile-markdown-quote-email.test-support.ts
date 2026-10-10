// 2026-10-10, from the phone (dark, screenshots beside the Claude Android app):
// a reply holding an email draft in a `>` quote. The Claude app drew the quote
// as Markdown: paragraphs, a real bulleted list, "My details:" and each detail
// on its own line, the sign-off one line each, and the address as a link. Code
// UI drew the list as literal "- " lines, ran the details and the sign-off
// together into one line each, linked nothing, and set the paragraphs a whole
// blank line apart; its Copy gave the same. The reply as the agent wrote it,
// soft newlines and all (the details and the sign-off are NOT hard-broken in
// the source).
export const QUOTED_EMAIL_REPLY = [
  '**Subject:** Request for Radiation Safety and IV Skills access - Alex Morgan, MV Example',
  '',
  '> Dear Sam,',
  '>',
  '> I hope you are well. I am a nurse on board MV Example, and I joined on 8 October 2026. Chris Lane advised me to contact you for access to the following courses:',
  '>',
  '> - Radiation Safety training',
  '> - IV Skills',
  '>',
  '> My details:',
  '> Name: Alex Morgan',
  '> Email: alex.morgan42@example.com',
  '> Nationality: Indian',
  '> Staff ID: 100200',
  '>',
  '> I understand I will have 30 days from receiving the login details to complete the courses and download my certificates.',
  '>',
  '> Thank you very much.',
  '>',
  '> Best regards,',
  '> Alex Morgan',
  '> Nurse, MV Example',
  '',
  'Alex has 30 days from the moment the login details arrive, so send this only when she has time on board to finish both. Say "send" when she\'s ready.'
].join('\n')

/** The same reply with each line break written as one, the two ways Markdown
 *  spells a hard break; the Claude app draws all three alike. */
export const QUOTED_EMAIL_REPLY_TWO_SPACES = QUOTED_EMAIL_REPLY.replace(
  /^(> (?:My details:|Name: .*|Email: .*|Nationality: .*|Best regards,|Alex Morgan))$/gm,
  '$1  '
)
export const QUOTED_EMAIL_REPLY_BACKSLASH = QUOTED_EMAIL_REPLY.replace(
  /^(> (?:My details:|Name: .*|Email: .*|Nationality: .*|Best regards,|Alex Morgan))$/gm,
  '$1\\'
)

export const QUOTED_EMAIL_DETAILS =
  'My details:\nName: Alex Morgan\nEmail: alex.morgan42@example.com\nNationality: Indian\nStaff ID: 100200'
export const QUOTED_EMAIL_SIGN_OFF = 'Best regards,\nAlex Morgan\nNurse, MV Example'

/** What a Copy of the reply puts on the clipboard: the words as drawn, the
 *  bullets as their glyph, each line of the details and the sign-off its own
 *  line, and one blank line between paragraphs. */
export const QUOTED_EMAIL_COPY = [
  'Subject: Request for Radiation Safety and IV Skills access - Alex Morgan, MV Example',
  '',
  'Dear Sam,',
  '',
  'I hope you are well. I am a nurse on board MV Example, and I joined on 8 October 2026. Chris Lane advised me to contact you for access to the following courses:',
  '',
  '• Radiation Safety training',
  '• IV Skills',
  '',
  QUOTED_EMAIL_DETAILS,
  '',
  'I understand I will have 30 days from receiving the login details to complete the courses and download my certificates.',
  '',
  'Thank you very much.',
  '',
  QUOTED_EMAIL_SIGN_OFF,
  '',
  'Alex has 30 days from the moment the login details arrive, so send this only when she has time on board to finish both. Say "send" when she\'s ready.'
].join('\n')
