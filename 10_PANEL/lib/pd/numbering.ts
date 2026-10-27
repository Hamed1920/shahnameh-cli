// Numbering for production-panel ids. Numbers are never reused, retired ones included.

// Next free number: max + 1. Pass every number ever used (retired too).
export function nextNumber(existing: number[]): number {
  let max = 0;
  for (const n of existing) if (Number.isFinite(n) && n > max) max = n;
  return max + 1;
}

export type GKey = { key: string; g: number };
export type GIncoming = { key: string; at: string };

// Assign frozen G numbers to keys not yet numbered, in time order after the current max.
// Existing keys keep their number; repeated incoming keys are numbered once.
export function nextGNumbers(existing: GKey[], incoming: GIncoming[]): GKey[] {
  const known = new Set(existing.map((e) => e.key));
  let next = nextNumber(existing.map((e) => e.g));
  const fresh = incoming
    .filter((i) => !known.has(i.key))
    .map((i, idx) => ({ ...i, idx }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.idx - b.idx));
  const out: GKey[] = [];
  const seen = new Set<string>();
  for (const f of fresh) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    out.push({ key: f.key, g: next++ });
  }
  return out;
}

// G01, G02 ... G99, G100 (widens past 99).
export function gLabel(n: number): string {
  return `G${String(n).padStart(2, '0')}`;
}
