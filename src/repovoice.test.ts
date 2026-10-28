import { describe, expect, it } from "vitest";
import { scanRepo, spokenForm, splitIdentifier, parsePackages } from "./extract";
import { toDictionaryCsv, toSnippets } from "./exporters";
import { accuracy, learnedCorrections, scoreRow } from "./voicetest";
import { parseGitHubUrl, wanted } from "./sources";

describe("identifiers", () => {
  it("splits camel, pascal, snake and acronyms", () => {
    expect(splitIdentifier("PriceLevelUpdate")).toEqual(["Price", "Level", "Update"]);
    expect(splitIdentifier("HTTPServer")).toEqual(["HTTP", "Server"]);
    expect(splitIdentifier("order_book.rs")).toEqual(["order", "book", "rs"]);
    expect(splitIdentifier("sha256Hash")).toEqual(["sha256", "Hash"]);
  });

  it("speaks identifiers the way you would say them", () => {
    expect(spokenForm("PriceLevelUpdate")).toBe("price level update");
    expect(spokenForm("HTTPServer")).toBe("HTTP server");
    expect(spokenForm("serde_json")).toBe("serde json");
  });
});

const repo = {
  name: "order-gateway",
  description: "Streams exchange order books",
  files: [
    {
      path: "src/book.rs",
      content: "pub struct PriceLevelUpdate { side: Side }\nfn apply_update(u: PriceLevelUpdate) {}\nfn update() {}\nfn test_apply() {}",
    },
    { path: "Cargo.toml", content: "[package]\nname = \"x\"\n[dependencies]\ntokio = \"1\"\nserde_json = \"1\"\n" },
  ],
};

describe("scanRepo", () => {
  const scan = scanRepo(repo);
  const byWritten = new Map(scan.terms.map((t) => [t.written, t]));

  it("turns multi-word identifiers into corrections", () => {
    expect(byWritten.get("PriceLevelUpdate")).toMatchObject({ mode: "correction", spoken: "price level update", count: 2 });
    expect(byWritten.get("apply_update")?.mode).toBe("correction");
  });

  it("keeps rare single words as vocabulary and drops everyday words and tests", () => {
    expect(byWritten.get("tokio")).toMatchObject({ mode: "vocab", kind: "package" });
    expect(byWritten.has("update")).toBe(false);
    expect(byWritten.has("test_apply")).toBe(false);
  });

  it("keeps one identifier per spoken phrase", () => {
    const twins = scanRepo({
      name: "x",
      description: "",
      files: [{ path: "a.rs", content: "struct AlignedSbeWriter; mod aligned_sbe_writer; AlignedSbeWriter AlignedSbeWriter" }],
    });
    const spoken = twins.terms.filter((t) => t.spoken === "aligned sbe writer");
    expect(spoken.map((t) => t.written)).toEqual(["AlignedSbeWriter"]);
  });

  it("ranks the repo name first", () => {
    expect(scan.terms[0].written).toBe("order-gateway");
  });

  it("reads manifests", () => {
    expect(parsePackages(repo.files).packages).toEqual(["tokio", "serde_json"]);
    expect(scan.languages).toEqual(["Rust"]);
  });
});

describe("exports", () => {
  const scan = scanRepo(repo);

  it("writes Flow's headerless CSV with learned corrections first and no duplicates", () => {
    const csv = toDictionaryCsv(scan.terms, [{ heard: "Price Level, update", written: "PriceLevelUpdate" }]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe('"Price Level, update",PriceLevelUpdate');
    expect(lines).toContain("price level update,PriceLevelUpdate");
    expect(lines).toContain("tokio");
    expect(new Set(lines.map((l) => l.split(",")[0].toLowerCase())).size).toBe(lines.length);
  });

  it("writes snippets within Flow's limits", () => {
    const snippets = toSnippets(scan, scan.terms);
    expect(snippets.map((s) => s.name)).toContain("order gateway context");
    for (const s of snippets) {
      expect(s.name.length).toBeLessThanOrEqual(60);
      expect(s.text.length).toBeLessThanOrEqual(4000);
    }
  });
});

describe("voice test", () => {
  it("scores exact identifiers, forgiving trailing punctuation", () => {
    const rows = [scoreRow("PriceLevelUpdate", "PriceLevelUpdate."), scoreRow("apply_update", "apply update"), scoreRow("tokio", "")];
    expect(rows.map((r) => r.exact)).toEqual([true, false, false]);
    expect(accuracy(rows)).toBe(50);
    expect(learnedCorrections(rows)).toEqual([{ heard: "apply update", written: "apply_update" }]);
  });
});

describe("sources", () => {
  it("parses GitHub references", () => {
    expect(parseGitHubUrl("raj921/engineering-challenge-template")).toEqual({ owner: "raj921", repo: "engineering-challenge-template", branch: undefined });
    expect(parseGitHubUrl("https://github.com/a/b.git")).toMatchObject({ owner: "a", repo: "b" });
    expect(parseGitHubUrl("https://github.com/a/b/tree/dev")).toMatchObject({ branch: "dev" });
    expect(parseGitHubUrl("not a repo")).toBeNull();
  });

  it("skips build output and vendored code", () => {
    expect(wanted("src/main.rs")).toBe(true);
    expect(wanted("target/debug/x.rs")).toBe(false);
    expect(wanted("node_modules/a/index.js")).toBe(false);
    expect(wanted("README.md")).toBe(true);
  });
});
