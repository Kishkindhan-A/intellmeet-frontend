// Keep drafts in this tab's memory only; never write meeting content to browser storage.
export type NoteDraft = { text: string; revision: number };
export const noteDrafts = new Map<string, NoteDraft>();
window.addEventListener('session-ended', () => noteDrafts.clear());
