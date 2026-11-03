/** Request limits shared by the browser UI and the API routes. */

export const PROMPT_MAX_CHARS = 4000;
export const REFINE_SOURCE_MAX_CHARS = 6000;
export const REFINE_INSTRUCTION_MAX_CHARS = 500;
export const CLARIFICATION_ANSWER_MAX_CHARS = 3000;

/**
 * Headroom for both clients, not just this site.
 *
 * The browser extension appends four "quality" clarifications of its own to
 * whatever the user answered. Guided mode asks three questions, so the extension
 * sends seven, and the previous cap of six rejected that with a 400, breaking
 * guided mode there entirely. Anything raising this must stay ahead of
 * (extension quality clarifications + guided questions).
 */
export const MAX_CLARIFICATIONS = 10;
