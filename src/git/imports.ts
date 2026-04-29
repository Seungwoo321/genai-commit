/**
 * Import graph extraction for cluster-aware chunking.
 *
 * The chunked commit flow groups files into chunks before asking the AI to
 * write per-chunk commit messages. Directory adjacency alone is a poor proxy
 * for "files that should commit together" — a refactor often spans multiple
 * directories along import edges. This module produces a deterministic
 * directed graph of intra-changeset imports so the cluster step can group
 * structurally connected files even when their paths diverge.
 *
 * Strictly deterministic by design: regex parsing, no AST or type resolver.
 * The principle is that structural clustering must be reproducible from the
 * inputs alone — non-deterministic judgment (e.g. grouping files the graph
 * cannot connect, writing the natural-language message) belongs to the AI
 * layer, not here. Regex misses some edges (computed `require`, re-exports
 * via tooling) and that is acceptable: a missing edge degrades cluster
 * cohesion but never breaks coverage, since the bin-packer downstream still
 * places every file into exactly one chunk.
 *
 * Only intra-changeset edges are recorded. External packages and unchanged
 * project files are dropped — the graph exists to cluster the changed set,
 * not to model the whole project. Bare specifiers (`react`, `lodash/fp`,
 * `github.com/foo/bar`) are ignored.
 */

import path from 'node:path';

export type SourceLanguage =
  | 'ts'
  | 'js'
  | 'py'
  | 'go'
  | 'rust'
  | 'java'
  | 'unknown';

/**
 * Per-language patterns for module-reference extraction. Patterns capture the
 * raw specifier as written in source; resolution to a concrete file path is
 * the next step.
 *
 * TS/JS share a pattern set because their import syntax is identical for the
 * forms we care about.
 */
const PATTERNS: Record<SourceLanguage, RegExp[]> = {
  ts: [
    /^\s*import\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm,
    /^\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ],
  js: [
    /^\s*import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm,
    /^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ],
  py: [
    /^\s*from\s+(\.+[\w.]*|[\w.]+)\s+import\s+/gm,
    /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm,
  ],
  go: [
    // Single-import line: `import "path"` or `import alias "path"`.
    /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm,
    // Block-import body: each line inside `import ( ... )` is `"path"` or
    // `alias "path"`. The pattern matches any quoted string on its own line
    // within the file; the parent module already filters bare specifiers, so
    // this over-matches harmlessly.
    /^\s*(?:[\w.]+\s+)?"([^"]+)"\s*$/gm,
  ],
  rust: [
    // `use crate::a::b;`, `use super::x;`, `use self::y;`. Captures the path
    // body for resolution against the module tree of the changed set.
    /^\s*(?:pub\s+)?use\s+((?:crate|super|self)(?:::[\w*{},\s]+)*);?/gm,
    // `mod foo;` declarations introduce a sibling/child file edge.
    /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm,
  ],
  java: [
    /^\s*import\s+(?:static\s+)?([\w.]+)(?:\.\*)?\s*;/gm,
  ],
  unknown: [],
};

const LANGUAGE_BY_EXT: Record<string, SourceLanguage> = {
  '.ts': 'ts',
  '.tsx': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.js': 'js',
  '.jsx': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.py': 'py',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
};

/**
 * Detect the source language from the file extension. Returns 'unknown' for
 * extensions outside the supported set so the caller can skip extraction
 * without throwing.
 */
export function detectSourceLanguage(filePath: string): SourceLanguage {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_BY_EXT[ext] ?? 'unknown';
}

/**
 * Extract the raw module specifiers referenced by a source file. Returns
 * deduplicated specifiers in first-seen order so downstream resolution is
 * deterministic. Python `import a, b` lines expand into individual specifiers.
 *
 * Returns an empty array for unknown languages; callers do not need to
 * pre-filter.
 */
export function extractImports(filePath: string, content: string): string[] {
  const lang = detectSourceLanguage(filePath);
  if (lang === 'unknown') return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const pattern of PATTERNS[lang]) {
    // Reset lastIndex defensively: the patterns are reused across files and
    // a stray /g state would skip matches in subsequent calls.
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      const raw = m[1];
      if (lang === 'py' && /^\s*import\s/m.test(m[0]) && !m[0].includes('from')) {
        // `import a, b, c` — split on commas and emit one specifier each.
        for (const part of raw.split(',')) {
          const spec = part.trim();
          if (spec && !seen.has(spec)) {
            seen.add(spec);
            out.push(spec);
          }
        }
      } else {
        const spec = raw.trim();
        if (spec && !seen.has(spec)) {
          seen.add(spec);
          out.push(spec);
        }
      }
    }
  }

  return out;
}

const TS_JS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const TS_JS_INDEX_NAMES = TS_JS_EXTS.map((e) => `index${e}`);

/**
 * Try every candidate path against the changed-file set, returning the first
 * match. The set lookup is exact-match by repo-relative posix path.
 */
function pickFirstMatch(
  candidates: string[],
  changedFiles: Set<string>
): string | null {
  for (const c of candidates) {
    if (changedFiles.has(c)) return c;
  }
  return null;
}

/**
 * Generate every candidate file path for a TS/JS specifier, given the
 * importer's directory. Resolution mirrors Node/bundler conventions in the
 * minimal way the cluster step needs:
 *  - bare `./foo` may be `foo.ts`, `foo/index.ts`, etc.
 *  - explicit extensions are tried first (handles `./foo.js` -> `./foo.ts`
 *    style cross-extension imports common in ESM-published TypeScript).
 */
function tsJsCandidates(importerDir: string, spec: string): string[] {
  const base = path.posix.normalize(path.posix.join(importerDir, spec));
  const out: string[] = [];

  // Strip the importer-supplied extension if present and re-try with all
  // known extensions. This is what makes `./foo.js` resolve to `foo.ts` in
  // the changed set.
  const ext = path.posix.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;

  if (ext) out.push(base);
  for (const e of TS_JS_EXTS) {
    out.push(stem + e);
  }
  for (const name of TS_JS_INDEX_NAMES) {
    out.push(path.posix.join(base, name));
    if (stem !== base) out.push(path.posix.join(stem, name));
  }
  return out;
}

/**
 * Generate Python candidates. Relative imports use leading dots (`.x`,
 * `..pkg.mod`); absolute imports map directly under the project root or any
 * package root that exists in the changeset.
 */
function pyCandidates(importerDir: string, spec: string): string[] {
  const out: string[] = [];

  if (spec.startsWith('.')) {
    // Count leading dots: 1 = same package, 2 = parent, etc.
    const dots = spec.match(/^\.+/)![0].length;
    const rest = spec.slice(dots).replace(/\./g, '/');
    const up = Array(dots - 1).fill('..').join('/');
    const baseDir = up ? path.posix.join(importerDir, up) : importerDir;
    const base = rest ? path.posix.join(baseDir, rest) : baseDir;
    out.push(base + '.py');
    out.push(path.posix.join(base, '__init__.py'));
  } else {
    // Absolute: try as project-rooted path. Without project metadata we
    // cannot disambiguate package roots, so we just emit the dotted path
    // resolved from the repo root. The changed-file set filters the rest.
    const asPath = spec.replace(/\./g, '/');
    out.push(asPath + '.py');
    out.push(path.posix.join(asPath, '__init__.py'));
  }

  return out;
}

/**
 * Rust candidates. We only resolve `crate::`, `super::`, `self::`, and bare
 * `mod foo;` declarations — all relative to the importer's module position.
 * Without `Cargo.toml` parsing we cannot map `crate::` to the actual src
 * root, so we treat it as the nearest ancestor `src/` directory; if none
 * exists in the changed set, the edge is dropped.
 */
function rustCandidates(importerDir: string, spec: string): string[] {
  const out: string[] = [];
  const head = spec.split('::')[0];
  const tail = spec.split('::').slice(1).join('/');

  if (head === 'self') {
    if (tail) {
      out.push(path.posix.join(importerDir, tail + '.rs'));
      out.push(path.posix.join(importerDir, tail, 'mod.rs'));
    }
  } else if (head === 'super') {
    const parent = path.posix.dirname(importerDir);
    if (tail) {
      out.push(path.posix.join(parent, tail + '.rs'));
      out.push(path.posix.join(parent, tail, 'mod.rs'));
    }
  } else if (head === 'crate') {
    // Walk up until we hit `src/`; if not found, give up.
    const segs = importerDir.split('/');
    const idx = segs.lastIndexOf('src');
    if (idx >= 0) {
      const root = segs.slice(0, idx + 1).join('/');
      if (tail) {
        out.push(path.posix.join(root, tail + '.rs'));
        out.push(path.posix.join(root, tail, 'mod.rs'));
      }
    }
  } else {
    // `mod foo;` — sibling file or subdirectory.
    out.push(path.posix.join(importerDir, head + '.rs'));
    out.push(path.posix.join(importerDir, head, 'mod.rs'));
  }

  return out;
}

/**
 * Java candidates. `package a.b.c;` maps to `a/b/c/`. Without scanning
 * `package` declarations we approximate by mapping the import's package
 * path to a posix path and trying it as `Class.java` under any matching
 * source root in the changed set.
 */
function javaCandidates(spec: string): string[] {
  const segs = spec.split('.');
  const pkg = segs.slice(0, -1).join('/');
  const cls = segs[segs.length - 1];
  // Common Maven/Gradle layouts: src/main/java, src/test/java. Without a
  // build descriptor we emit both and let the changed-file set filter.
  return [
    path.posix.join('src/main/java', pkg, cls + '.java'),
    path.posix.join('src/test/java', pkg, cls + '.java'),
    path.posix.join(pkg, cls + '.java'),
  ];
}

/**
 * Go candidates. We can only meaningfully resolve intra-module relative
 * imports if we know the module path (declared in `go.mod`). Without it,
 * bare specifiers like `github.com/owner/repo/internal/foo` are dropped.
 * This is acceptable — Go imports tend to be flat enough that directory
 * adjacency from the chunker's secondary sort handles them.
 *
 * Intentionally returns no candidates; an extended go.mod-aware resolver
 * can layer on later when there is a concrete failure to motivate it.
 */
function goCandidates(_importerDir: string, _spec: string): string[] {
  return [];
}

/**
 * Resolve a raw import specifier to a path inside the changed-file set, or
 * null if the specifier points outside the set (external package, unchanged
 * project file, or unparseable). Path comparison is posix throughout — the
 * git layer feeds us forward-slash paths regardless of platform.
 */
export function resolveImport(
  importer: string,
  spec: string,
  changedFiles: Set<string>
): string | null {
  const lang = detectSourceLanguage(importer);
  if (lang === 'unknown') return null;

  const importerDir = path.posix.dirname(importer);

  let candidates: string[] = [];
  switch (lang) {
    case 'ts':
    case 'js':
      // Skip bare specifiers: anything not starting with '.' or '/' is an
      // external package or path-mapped alias we cannot resolve here.
      if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
      candidates = tsJsCandidates(importerDir, spec);
      break;
    case 'py':
      candidates = pyCandidates(importerDir, spec);
      break;
    case 'go':
      candidates = goCandidates(importerDir, spec);
      break;
    case 'rust':
      candidates = rustCandidates(importerDir, spec);
      break;
    case 'java':
      candidates = javaCandidates(spec);
      break;
  }

  return pickFirstMatch(candidates, changedFiles);
}

/**
 * Build the directed import graph over a set of changed files.
 *
 * Inputs map each file to its source content. The result is an adjacency map
 * where keys are every input path (including files with no outgoing edges)
 * and values are the set of changed files they import. The graph is
 * directed; the cluster step treats it as undirected when computing weakly
 * connected components.
 *
 * Determinism: the iteration order of the returned Map matches the
 * iteration order of the input Map, and each entry's Set preserves first-
 * seen edge order. Two equal inputs always produce equal graphs.
 */
export function buildImportGraph(
  fileContents: Map<string, string>
): Map<string, Set<string>> {
  const changedFiles = new Set(fileContents.keys());
  const graph = new Map<string, Set<string>>();

  for (const [file, content] of fileContents) {
    const edges = new Set<string>();
    const specs = extractImports(file, content);
    for (const spec of specs) {
      const resolved = resolveImport(file, spec, changedFiles);
      if (resolved && resolved !== file) {
        edges.add(resolved);
      }
    }
    graph.set(file, edges);
  }

  return graph;
}
