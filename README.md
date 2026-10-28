# RepoVoice

**Teach Wispr Flow your codebase.**

I write code by talking to AI tools through Wispr Flow. My prompts kept breaking on my
own repo's names: I say "aligned sbe reader" and Flow types *aligned SBE reader*, not
`AlignedSbeReader`. The AI then searches for the wrong thing, or I stop and fix it by hand,
which defeats the point of dictating.

RepoVoice reads a repository and builds the files Flow's bulk import takes:

- **Dictionary (.csv)**: a correction for every identifier you'd say out loud
  (`aligned sbe reader` → `AlignedSbeReader`), plus vocabulary for names Flow has never
  seen (`tokio`, `Polymarket`).
- **Snippets (.json)**: say "*repo* context" and Flow types a project briefing for your AI
  tool; also a file map, the repo's commands and a PR description template.
- **Voice test**: dictate 10 of your repo's hardest terms before and after importing and
  get an exact-match score. Every miss can be added back to the dictionary as a
  correction for *your* voice.

Everything runs in the browser. A GitHub URL is read through GitHub's public API; a local
folder never leaves your machine.

## How it picks terms

1. It reads source files and manifests (`Cargo.toml`, `package.json`, `requirements.txt`,
   `pyproject.toml`, `go.mod`, `Makefile`). It skips `target/`, `node_modules/`, `dist/`
   and vendored code, and reads at most 300 files, manifests and shallow paths first.
2. It collects declared names (structs, classes, functions, types, modules) in Rust,
   Python, TypeScript/JavaScript, Go, Java/Kotlin/C#/Swift, Ruby and C/C++, along with
   dependencies, the repo name and file names.
3. It scores each one by how often it's used, whether Flow would have to join or re-case
   it, and how many of its parts aren't everyday English. It drops what Flow already gets
   right (`update`, `symbol`), sentence-length test names, and private or test-only names.
4. When two identifiers sound the same (`AlignedSbeWriter` and `aligned_sbe_writer`), the
   more used one wins. Flow can turn one phrase into only one thing.
5. A correction made only of everyday words (`retry after` → `retry_after`) is flagged
   *common phrase* and left unselected, because it would also rewrite normal sentences.

The output follows Flow's documented import format: a headerless CSV with `word` or
`misspelling,correction` rows, at most 1,000 entries and 60 characters in the first field,
and a snippets JSON array of `{ "name", "text" }`.

## Run it

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # unit tests
npm run build   # static site in dist/
```

`dist/` is a static site, so any static host works (Vercel, Netlify, GitHub Pages).

## Submission notes (No Hands: The Wispr Challenge)

- **Problem:** dictated prompts to AI coding tools get my codebase's names wrong, so the
  AI works on the wrong thing.
- **Who it's for:** developers who code by voice with Wispr Flow, and teams onboarding
  onto Flow's shared dictionary.
- **How I used Wispr:** I dictated the research, the spec and every revision to Claude Code
  with Flow. The product only exists because of Flow: it writes Flow's own import format,
  and the before/after test is measured by dictating with Flow.
- **Result:** _fill in after running the voice test on your repo, e.g. "Flow went from X%
  to Y% exact on my order-book repo."_

## Frontend

The workspace is built with React, TypeScript, Vite and Tailwind CSS. The interface
uses semantic surface, foreground, border and state tokens inspired by the
[Interfere design system](https://design.interfere.com/), with light and dark themes.

Two components are vendored from the official [Spectrum UI](https://spectrumhq.in/)
registry and used in the application:

- **Stat Cards**: repository metrics and before/after accuracy, backed by actual scan
  and test results. Source: `src/components/spectrumui/charts/`.
- **Code Block**: dictionary and snippets previews, with copy and expand controls.
  Source: `src/components/spectrumui/blocks/ai-assistants/code-block.tsx`.

`src/App.tsx` owns navigation and browser state. The scanner, import formats and voice
scoring remain separate modules. The demo repository in `src/demo.ts` is explicit
sample data processed by the same scanner as real inputs. Voice-test results and
learned corrections are stored locally per repository; local source files are never
uploaded or stored by a server.

The interface supports mobile navigation, keyboard focus states, a quick-navigation
menu (`Cmd/Ctrl+K`), and reduced-motion preferences. To import output into Flow, open
Dictionary and import the downloaded CSV, then open Snippets and import the JSON.
