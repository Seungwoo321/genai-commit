/**
 * Tree summary generation.
 *
 * Produces a flat, line-per-file listing of every changed path so the AI
 * receives exact, verbatim filenames it can reference in its output.
 *
 * The previous implementation collapsed directories with many files into
 * synthetic labels like `src/foo/ [15 files: 15 *.ts]`. The AI would echo
 * those labels into its FILES list, producing paths `git add` could not
 * resolve AND leaving the real files uncommitted. Compression is therefore
 * omitted entirely — if the full listing exceeds the size budget, files are
 * truncated with an explicit marker instead of silently rewritten.
 */

import type { GitChange, ChangeStatus } from '../types/git.js';

export interface TreeSummaryOptions {
  maxTreeSize?: number;
}

const DEFAULT_MAX_TREE_SIZE = 20000;

/**
 * Format a single changed file line.
 */
function formatLine(
  file: string,
  changeType: ChangeStatus,
  renameMap?: Map<string, string>
): string {
  if (changeType === 'R' && renameMap?.has(file)) {
    return `${changeType} ${renameMap.get(file)} → ${file}`;
  }
  return `${changeType} ${file}`;
}

/**
 * Render a flat list of files with their change type.
 * No compression — every file is listed by exact path.
 */
export function generateTreeSummary(
  files: string[],
  changeType: ChangeStatus,
  renameMap?: Map<string, string>
): string {
  if (files.length === 0) {
    return '';
  }
  return files.map((f) => formatLine(f, changeType, renameMap)).join('\n');
}

/**
 * Build the full file tree section by change type.
 */
function buildTreeSections(branch: string, changes: GitChange[]): string {
  const added = changes.filter((c) => c.status === 'A').map((c) => c.file);
  const modified = changes.filter((c) => c.status === 'M').map((c) => c.file);
  const deleted = changes.filter((c) => c.status === 'D').map((c) => c.file);
  const renamedChanges = changes.filter((c) => c.status === 'R');
  const renamed = renamedChanges.map((c) => c.file);
  const renameMap = new Map<string, string>();
  for (const c of renamedChanges) {
    if (c.from) {
      renameMap.set(c.file, c.from);
    }
  }
  const untracked = changes.filter((c) => c.status === '?').map((c) => c.file);

  const total =
    added.length + modified.length + deleted.length + renamed.length + untracked.length;

  let output = `=== CHANGE SUMMARY ===
Branch: ${branch}
Total: ${total} files
  - Added (A): ${added.length}
  - Modified (M): ${modified.length}
  - Deleted (D): ${deleted.length}
  - Renamed (R): ${renamed.length}
  - Untracked (?): ${untracked.length}

=== FILE LIST ===
`;

  if (modified.length > 0) {
    output += `\n--- Modified (${modified.length}) ---\n`;
    output += generateTreeSummary(modified, 'M');
    output += '\n';
  }

  if (added.length > 0) {
    output += `\n--- Added (${added.length}) ---\n`;
    output += generateTreeSummary(added, 'A');
    output += '\n';
  }

  if (deleted.length > 0) {
    output += `\n--- Deleted (${deleted.length}) ---\n`;
    output += generateTreeSummary(deleted, 'D');
    output += '\n';
  }

  if (renamed.length > 0) {
    output += `\n--- Renamed (${renamed.length}) ---\n`;
    output += generateTreeSummary(renamed, 'R', renameMap);
    output += '\n';
  }

  if (untracked.length > 0) {
    output += `\n--- Untracked (${untracked.length}) ---\n`;
    output += generateTreeSummary(untracked, '?');
    output += '\n';
  }

  return output;
}

/**
 * Truncate the tree summary at the file-line level if it exceeds the cap.
 * Drops trailing file lines and appends an explicit marker so the AI knows
 * some files were omitted and must not invent names. Only lines that actually
 * represent a file (prefixed with A/M/D/R/?) count toward the "omitted"
 * number — section headers and dashes are structural noise.
 */
const FILE_LINE = /^[AMDR?] /;

function truncateTreeSummary(output: string, maxSize: number): string {
  if (output.length <= maxSize) {
    return output;
  }

  const lines = output.split('\n');
  const kept: string[] = [];
  let size = 0;
  let droppedFiles = 0;
  const marker = '\n[... N files omitted due to size limit; DO NOT invent filenames ...]';

  for (const line of lines) {
    const lineCost = line.length + 1;
    if (size + lineCost + marker.length > maxSize) {
      if (FILE_LINE.test(line)) {
        droppedFiles++;
      }
    } else {
      kept.push(line);
      size += lineCost;
    }
  }

  // Nothing was actually dropped — the size check was a false alarm (e.g.
  // marker-length padding pushed output above maxSize but every line fits).
  if (kept.length === lines.length) {
    return output;
  }

  const truncated = kept.join('\n');

  // Only emit the file-omission marker if real file lines were dropped;
  // when only structural lines were trimmed, the AI does not need a warning.
  if (droppedFiles === 0) {
    return truncated;
  }

  return truncated + marker.replace('N', String(droppedFiles));
}

/**
 * Generate the full tree summary for the provided changes.
 */
export function generateFullTreeSummary(
  branch: string,
  changes: GitChange[],
  options: TreeSummaryOptions = {}
): string {
  const maxTreeSize = options.maxTreeSize ?? DEFAULT_MAX_TREE_SIZE;
  const output = buildTreeSections(branch, changes);
  return truncateTreeSummary(output, maxTreeSize);
}
