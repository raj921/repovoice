import { spokenForm, type Scan, type Term } from "./extract";

export const MAX_ENTRIES = 1000;
const MAX_NAME = 60;
const MAX_TEXT = 4000;

export interface Correction {
  heard: string;
  written: string;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Flow's dictionary CSV: no header, `word` or `misspelling,correction` per row.
export function toDictionaryCsv(terms: Term[], learned: Correction[] = []): string {
  const rows: string[] = [];
  const seen = new Set<string>();
  const push = (first: string, second?: string) => {
    const key = first.trim().toLowerCase();
    if (!key || key.length > MAX_NAME || seen.has(key) || rows.length >= MAX_ENTRIES) return;
    seen.add(key);
    rows.push(second === undefined ? csvField(first) : `${csvField(first)},${csvField(second)}`);
  };
  // Corrections learned from your own mis-hearings go first: they are proven misses.
  for (const c of learned) push(c.heard, c.written);
  for (const t of terms) {
    if (t.mode === "correction") push(t.spoken, t.written);
    else push(t.written);
  }
  return rows.join("\n") + "\n";
}

function clip(text: string): string {
  return text.length <= MAX_TEXT ? text : text.slice(0, MAX_TEXT - 1) + "…";
}

function triggerName(repoSpoken: string, suffix: string): string {
  return `${repoSpoken} ${suffix}`.slice(0, MAX_NAME).trim();
}

function topDirectories(scan: Scan): string[] {
  const counts = new Map<string, number>();
  for (const f of scan.repo.files) {
    const parts = f.path.split("/");
    const dir = parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join("/") + "/" : "(root)";
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([d, n]) => `${d} (${n} files)`);
}

export function readmeSummary(scan: Scan): string {
  const readme = scan.repo.files.find((f) => /^readme\.md$/i.test(f.path));
  if (!readme) return "";
  const para = readme.content
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#") && !p.startsWith("![") && !p.startsWith("[!") && !p.startsWith("<"));
  return para ? para.replace(/\s+/g, " ").slice(0, 400) : "";
}

// Flow's snippets JSON: an array of { name, text }. You say the name, Flow types the text.
export function toSnippets(scan: Scan, selected: Term[]): Array<{ name: string; text: string }> {
  const repoSpoken = spokenForm(scan.repo.name);
  const about = scan.repo.description || readmeSummary(scan);
  const identifiers = selected.filter((t) => t.kind === "identifier").slice(0, 25).map((t) => t.written);
  const snippets: Array<{ name: string; text: string }> = [];

  snippets.push({
    name: triggerName(repoSpoken, "context"),
    text: clip(
      [
        `Project: ${scan.repo.name}`,
        about ? `About: ${about}` : "",
        scan.languages.length ? `Languages: ${scan.languages.slice(0, 4).join(", ")}` : "",
        scan.packages.length ? `Key dependencies: ${scan.packages.slice(0, 15).join(", ")}` : "",
        identifiers.length ? `Core types and functions: ${identifiers.join(", ")}` : "",
        "Match the existing naming and structure. Keep changes small and explain the reasoning.",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  });

  snippets.push({
    name: triggerName(repoSpoken, "file map"),
    text: clip(`Where things live in ${scan.repo.name}:\n` + topDirectories(scan).map((d) => `- ${d}`).join("\n")),
  });

  if (scan.scripts.length) {
    snippets.push({
      name: triggerName(repoSpoken, "commands"),
      text: clip(`Commands for ${scan.repo.name}:\n` + scan.scripts.slice(0, 15).map((s) => `- ${s}`).join("\n")),
    });
  }

  const template = scan.repo.files.find((f) => /pull_request_template\.md$/i.test(f.path));
  snippets.push({
    name: triggerName(repoSpoken, "PR description"),
    text: clip(
      template?.content.trim() ||
        "## What changed\n\n## Why\n\n## How I tested it\n\n## Risks and follow-ups\n",
    ),
  });

  return snippets;
}
