import { COMMON } from "./words";

export interface SourceFile {
  path: string;
  content: string;
}

export interface RepoInput {
  name: string;
  description: string;
  files: SourceFile[];
}

export type TermKind = "repo" | "package" | "identifier" | "file";

// mode "correction" writes `spoken,written` so Flow turns what you say into the
// exact identifier; "vocab" writes the word alone so Flow learns its spelling.
export interface Term {
  written: string;
  spoken: string;
  kind: TermKind;
  count: number;
  score: number;
  mode: "correction" | "vocab";
  // A correction made only of everyday words ("retry after" -> retry_after)
  // would also rewrite ordinary sentences, so it starts unselected.
  risky: boolean;
  sources: string[];
}

export interface Scan {
  repo: RepoInput;
  terms: Term[];
  packages: string[];
  languages: string[];
  scripts: string[];
}

const MAX_FIELD = 60;

const DECLARATIONS: Array<[RegExp, RegExp]> = [
  [/\.rs$/, /\b(?:struct|enum|trait|fn|type|mod|union|const|static)\s+([A-Za-z_][A-Za-z0-9_]*)/g],
  [/\.py$/, /\b(?:class|def)\s+([A-Za-z_]\w*)/g],
  [/\.(?:ts|tsx|js|jsx|mjs|cjs)$/, /\b(?:class|function|interface|type|enum|const|let)\s+([A-Za-z_$][\w$]*)/g],
  [/\.go$/, /\b(?:func(?:\s*\([^)]*\))?|type)\s+([A-Za-z_]\w*)/g],
  [/\.(?:java|kt|kts|cs|scala|swift|dart)$/, /\b(?:class|interface|enum|struct|record|object|protocol|fun|func)\s+([A-Za-z_]\w*)/g],
  [/\.rb$/, /\b(?:class|module|def)\s+([A-Za-z_]\w*)/g],
  [/\.(?:c|h|cc|cpp|hpp)$/, /\b(?:struct|class|enum)\s+([A-Za-z_]\w*)/g],
];

const LANGUAGES: Record<string, string> = {
  rs: "Rust", py: "Python", ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
  go: "Go", java: "Java", kt: "Kotlin", cs: "C#", swift: "Swift", rb: "Ruby", c: "C", cpp: "C++",
  cc: "C++", h: "C", hpp: "C++", scala: "Scala", dart: "Dart",
};

export const SOURCE_EXTENSIONS = new Set(Object.keys(LANGUAGES));

// PriceLevelUpdate -> [Price, Level, Update]; HTTPServer -> [HTTP, Server];
// order_book.rs -> [order, book, rs]. Digits stay with their word (sha256).
export function splitIdentifier(id: string): string[] {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-./@]+/)
    .filter(Boolean);
}

export function spokenForm(id: string): string {
  return splitIdentifier(id)
    .map((p) => (/^[A-Z0-9]{2,5}$/.test(p) && /[A-Z]/.test(p) ? p : p.toLowerCase()))
    .join(" ");
}

function fileSpoken(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return spokenForm(name);
  return `${spokenForm(name.slice(0, dot))} dot ${name.slice(dot + 1).toLowerCase()}`;
}

export function extension(path: string): string {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function isNoise(id: string): boolean {
  if (id.length < 3 || id.length > MAX_FIELD) return true;
  if (/^_/.test(id) || /^\d/.test(id)) return true;
  if (/^test[_A-Z]/.test(id) || /^Test[A-Z]/.test(id)) return true;
  return false;
}

export function parsePackages(files: SourceFile[]): { packages: string[]; scripts: string[] } {
  const packages = new Set<string>();
  const scripts: string[] = [];
  for (const f of files) {
    const name = basename(f.path);
    if (name === "package.json") {
      try {
        const pkg = JSON.parse(f.content);
        for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
          for (const dep of Object.keys(pkg[key] ?? {})) {
            if (!dep.startsWith("@types/")) packages.add(dep);
          }
        }
        for (const s of Object.keys(pkg.scripts ?? {})) scripts.push(`npm run ${s}`);
      } catch {
        // A malformed manifest only costs us its packages.
      }
    } else if (name === "Cargo.toml") {
      let inDeps = false;
      for (const line of f.content.split(/\r?\n/)) {
        const section = line.match(/^\s*\[([^\]]+)\]/);
        if (section) {
          inDeps = /dependencies$/.test(section[1]);
          continue;
        }
        const dep = inDeps && line.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
        if (dep) packages.add(dep[1]);
      }
      if (!scripts.includes("cargo test")) scripts.push("cargo build", "cargo test", "cargo clippy");
    } else if (/^requirements.*\.txt$/.test(name)) {
      for (const line of f.content.split(/\r?\n/)) {
        const dep = line.match(/^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)/);
        if (dep && !line.trim().startsWith("-")) packages.add(dep[1]);
      }
    } else if (name === "pyproject.toml") {
      for (const m of f.content.matchAll(/^\s*"([A-Za-z0-9][A-Za-z0-9_.-]*)\s*(?:[<>=!~\[;,]|")/gm)) {
        packages.add(m[1]);
      }
    } else if (name === "go.mod") {
      for (const m of f.content.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]+\/[^\s]+)\s+v\d/gm)) {
        packages.add(m[1].split("/").pop()!);
      }
      if (!scripts.includes("go test ./...")) scripts.push("go build ./...", "go test ./...");
    } else if (name === "Makefile") {
      for (const m of f.content.matchAll(/^([a-zA-Z][\w-]*):(?!=)/gm)) scripts.push(`make ${m[1]}`);
    }
  }
  return { packages: [...packages], scripts: [...new Set(scripts)] };
}

export function scanRepo(repo: RepoInput): Scan {
  const tokenCounts = new Map<string, number>();
  const declared = new Map<string, Set<string>>();
  const langCounts = new Map<string, number>();

  for (const f of repo.files) {
    for (const m of f.content.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      tokenCounts.set(m[0], (tokenCounts.get(m[0]) ?? 0) + 1);
    }
    const ext = extension(f.path);
    if (LANGUAGES[ext]) langCounts.set(LANGUAGES[ext], (langCounts.get(LANGUAGES[ext]) ?? 0) + 1);
    for (const [fileRe, declRe] of DECLARATIONS) {
      if (!fileRe.test(f.path)) continue;
      for (const m of f.content.matchAll(declRe)) {
        if (isNoise(m[1])) continue;
        if (!declared.has(m[1])) declared.set(m[1], new Set());
        declared.get(m[1])!.add(f.path);
      }
    }
  }

  const { packages, scripts } = parsePackages(repo.files);
  const terms = new Map<string, Term>();

  const add = (written: string, spoken: string, kind: TermKind, count: number, sources: string[]) => {
    if (isNoise(written) || spoken.length > MAX_FIELD) return;
    const key = written.toLowerCase();
    if (terms.has(key)) return;
    const parts = splitIdentifier(written);
    // Sentence-length names (descriptive test functions) are never dictated.
    if (parts.length > 6) return;
    const rare = parts.filter((p) => !COMMON.has(p.toLowerCase())).length;
    const needsJoin = spoken.toLowerCase() !== written.toLowerCase();
    // A lone everyday word ("update", "Config") is already spelled right by Flow.
    if (!needsJoin && rare === 0) return;
    // A lowercase one-word function or module (symbol, shard) is ordinary English;
    // a capitalised one (Polymarket) is a name Flow has never seen.
    if (kind === "identifier" && parts.length === 1 && written === written.toLowerCase()) return;
    const kindBonus = { repo: 6, package: 3, identifier: 0, file: -1 }[kind];
    const shouting = /^[A-Z0-9_]+$/.test(written) ? -2 : 0;
    const wordy = parts.length > 4 ? (parts.length - 4) * 3 : 0;
    const fromTests = sources.length > 0 && sources.every((s) => /(?:^|\/)tests?\/|[._]test\.|_spec\./.test(s)) ? 4 : 0;
    const score =
      Math.log2(1 + count) * 2 + (needsJoin ? 3 : 0) + Math.min(rare, 3) * 2 + (parts.length > 1 ? 1 : 0) +
      kindBonus + shouting - wordy - fromTests;
    terms.set(key, {
      written,
      spoken,
      kind,
      count,
      score: Math.round(score * 10) / 10,
      mode: needsJoin ? "correction" : "vocab",
      risky: needsJoin && rare === 0,
      sources: sources.slice(0, 3),
    });
  };

  add(repo.name, spokenForm(repo.name), "repo", 1, []);
  for (const p of packages) add(p, spokenForm(p), "package", tokenCounts.get(p.replace(/-/g, "_")) ?? 1, []);
  for (const [id, paths] of declared) add(id, spokenForm(id), "identifier", tokenCounts.get(id) ?? 1, [...paths]);
  for (const f of repo.files) {
    if (!SOURCE_EXTENSIONS.has(extension(f.path))) continue;
    const name = basename(f.path);
    if (/^(?:mod|main|lib|index|__init__)\./.test(name)) continue;
    add(name, fileSpoken(name), "file", 1, [f.path]);
  }

  const languages = [...langCounts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  // One phrase can only become one identifier: AlignedSbeWriter and
  // aligned_sbe_writer both sound like "aligned sbe writer", so the more used wins.
  const spokenSeen = new Set<string>();
  const ranked = [...terms.values()]
    .sort((a, b) => b.score - a.score || a.written.localeCompare(b.written))
    .filter((t) => {
      const key = t.spoken.toLowerCase();
      if (spokenSeen.has(key)) return false;
      spokenSeen.add(key);
      return true;
    });
  return {
    repo,
    terms: ranked,
    packages,
    languages,
    scripts,
  };
}
