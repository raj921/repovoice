import { SOURCE_EXTENSIONS, extension, type RepoInput, type SourceFile } from "./extract";

const MAX_FILES = 300;
const MAX_BYTES = 200_000;
const MANIFESTS = /(?:^|\/)(?:package\.json|Cargo\.toml|requirements[^/]*\.txt|pyproject\.toml|go\.mod|Makefile|README\.md|pull_request_template\.md)$/i;
const SKIP_DIRS = /(?:^|\/)(?:node_modules|vendor|dist|build|target|\.git|\.next|out|coverage|third_party|__pycache__|\.venv|venv)\//;

export function wanted(path: string): boolean {
  if (SKIP_DIRS.test(path)) return false;
  if (/\.min\.js$|\.d\.ts$/.test(path)) return false;
  return MANIFESTS.test(path) || SOURCE_EXTENSIONS.has(extension(path));
}

// Shallow paths and manifests first, so a large repo is sampled from its core.
function prioritise(paths: string[]): string[] {
  const rank = (p: string) => (MANIFESTS.test(p) ? 0 : 1) * 100 + p.split("/").length + (/test/i.test(p) ? 5 : 0);
  return [...paths].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, MAX_FILES);
}

export function parseGitHubUrl(input: string): { owner: string; repo: string; branch?: string } | null {
  const m = input
    .trim()
    .match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:\/tree\/([^/?#]+))?\/?(?:[?#].*)?$/);
  return m ? { owner: m[1], repo: m[2], branch: m[3] } : null;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  if (res.status === 403 || res.status === 429) {
    throw new Error("GitHub's anonymous rate limit (60 requests an hour) is used up. Try again later, or scan a local folder.");
  }
  if (res.status === 404) throw new Error("Repository not found. Only public repositories can be scanned by URL; use a local folder for private ones.");
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${url}`);
  return res.json();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function fromGitHub(input: string, onProgress: (msg: string) => void): Promise<RepoInput> {
  const ref = parseGitHubUrl(input);
  if (!ref) throw new Error("That doesn't look like a GitHub repo. Use owner/repo or a github.com URL.");
  onProgress(`Looking up ${ref.owner}/${ref.repo}…`);
  const meta = await getJson(`https://api.github.com/repos/${ref.owner}/${ref.repo}`);
  const branch = ref.branch ?? meta.default_branch;
  const tree = await getJson(`https://api.github.com/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const paths = prioritise(
    (tree.tree as Array<{ path: string; type: string; size?: number }>)
      .filter((n) => n.type === "blob" && (n.size ?? 0) <= MAX_BYTES && wanted(n.path))
      .map((n) => n.path),
  );
  let done = 0;
  const files = await mapLimit(paths, 8, async (path): Promise<SourceFile | null> => {
    const url = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${encodeURIComponent(branch)}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const res = await fetch(url);
    onProgress(`Reading files ${++done}/${paths.length}…`);
    return res.ok ? { path, content: await res.text() } : null;
  });
  return { name: meta.name, description: meta.description ?? "", files: files.filter((f): f is SourceFile => f !== null) };
}

export async function fromFolder(list: FileList, onProgress: (msg: string) => void): Promise<RepoInput> {
  const all = [...list];
  if (!all.length) throw new Error("That folder is empty.");
  const root = all[0].webkitRelativePath.split("/")[0];
  const byPath = new Map(all.map((f) => [f.webkitRelativePath.split("/").slice(1).join("/"), f]));
  const paths = prioritise([...byPath.keys()].filter((p) => wanted(p) && byPath.get(p)!.size <= MAX_BYTES));
  let done = 0;
  const files = await mapLimit(paths, 16, async (path) => {
    const content = await byPath.get(path)!.text();
    onProgress(`Reading files ${++done}/${paths.length}…`);
    return { path, content };
  });
  return { name: root, description: "", files };
}
