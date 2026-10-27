import { createHash } from 'node:crypto';

// Trim, unify line endings, collapse runs of spaces/tabs, and drop blank-line runs.
export function normalizePrompt(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function promptHash(text: string): string {
  return createHash('sha256').update(normalizePrompt(text), 'utf8').digest('hex');
}
