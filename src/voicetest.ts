import type { Term } from "./extract";
import type { Correction } from "./exporters";

export interface RowResult {
  written: string;
  heard: string;
  exact: boolean;
}

// The test uses terms Flow is most likely to get wrong: ones it has to join or case.
export function pickTestTerms(terms: Term[], n = 10): Term[] {
  const corrections = terms.filter((t) => t.mode === "correction" && t.kind !== "file");
  const rest = terms.filter((t) => !corrections.includes(t));
  return [...corrections, ...rest].slice(0, n);
}

// Flow adds sentence punctuation to short dictations ("PriceLevelUpdate.").
export function cleanHeard(heard: string): string {
  return heard.trim().replace(/^["'`]+|["'`.,!?;:]+$/g, "").trim();
}

export function scoreRow(written: string, heard: string): RowResult {
  const clean = cleanHeard(heard);
  return { written, heard: clean, exact: clean === written };
}

export function accuracy(rows: RowResult[]): number {
  const answered = rows.filter((r) => r.heard);
  if (!answered.length) return 0;
  return Math.round((answered.filter((r) => r.exact).length / answered.length) * 100);
}

// Every miss is a real mis-hearing of your voice: feed it back as a correction.
export function learnedCorrections(rows: RowResult[]): Correction[] {
  return rows
    .filter((r) => r.heard && !r.exact && r.heard.length <= 60)
    .map((r) => ({ heard: r.heard, written: r.written }));
}
