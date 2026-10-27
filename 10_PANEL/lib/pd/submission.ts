// Review-round rules.

// Rounds count up from 1 and are never reused.
export function nextRound(existingRounds: number[]): number {
  let max = 0;
  for (const n of existingRounds) if (n > max) max = n;
  return max + 1;
}

// Only an approved submission can be made Final.
export function canFinalize(i: { submissionStatus: 'pending' | 'approved' | 'revision_requested' }): boolean {
  return i.submissionStatus === 'approved';
}

// Open continuity notes warn but do not block (plan default).
export function continuityWarning(openContinuity: number): string | null {
  if (openContinuity <= 0) return null;
  return openContinuity === 1
    ? '1 continuity note is still open.'
    : `${openContinuity} continuity notes are still open.`;
}
