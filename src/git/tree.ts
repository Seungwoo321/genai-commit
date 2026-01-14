/**
 * Tree summary compression (ported from bash awk logic)
 */

import type { GitChange, ChangeStatus } from '../types/git.js';

export interface TreeSummaryOptions {
  treeDepth: number;
  compressionThreshold: number;
}

const DEFAULT_OPTIONS: TreeSummaryOptions = {
  treeDepth: 3,
  compressionThreshold: 10,
};

/**
 * Get file extension from path
 */
function getExtension(file: string): string {
  const match = file.match(/\.([^./]+)$/);
  return match ? match[1] : '';
}

/**
 * Generate compressed tree summary for a list of files
 * Ported from bash awk logic in generate-commit-msg-claude.sh
 */
export function generateTreeSummary(
  files: string[],
  changeType: ChangeStatus,
  options: Partial<TreeSummaryOptions> = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (files.length === 0) {
    return '';
  }

  // If files are few, just list them
  if (files.length <= opts.compressionThreshold) {
    return files.map((f) => `${changeType} ${f}`).join('\n');
  }

  // Group files by directory at treeDepth level
  const dirGroups = new Map<string, { count: number; extensions: Map<string, number> }>();
  const directFiles: string[] = [];

  for (const file of files) {
    const parts = file.split('/');

    if (parts.length <= opts.treeDepth) {
      directFiles.push(`${changeType} ${file}`);
    } else {
      const dir = parts.slice(0, opts.treeDepth).join('/');
      const ext = getExtension(file);

      if (!dirGroups.has(dir)) {
        dirGroups.set(dir, { count: 0, extensions: new Map() });
      }

      const group = dirGroups.get(dir)!;
      group.count++;

      if (ext) {
        group.extensions.set(ext, (group.extensions.get(ext) ?? 0) + 1);
      }
    }
  }

  // Format compressed output: "M src/components/ [15 files: 8 *.tsx, 7 *.css]"
  const compressed = [...dirGroups.entries()].map(([dir, group]) => {
    const extSummary = [...group.extensions.entries()]
      .map(([ext, count]) => `${count} *.${ext}`)
      .join(', ');

    if (extSummary) {
      return `${changeType} ${dir}/ [${group.count} files: ${extSummary}]`;
    } else {
      return `${changeType} ${dir}/ [${group.count} files]`;
    }
  });

  return [...directFiles, ...compressed].join('\n');
}

/**
 * Generate full tree summary from git changes
 */
export function generateFullTreeSummary(
  branch: string,
  changes: GitChange[],
  options: Partial<TreeSummaryOptions> = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Group changes by status
  const added = changes.filter((c) => c.status === 'A').map((c) => c.file);
  const modified = changes.filter((c) => c.status === 'M').map((c) => c.file);
  const deleted = changes.filter((c) => c.status === 'D').map((c) => c.file);
  const renamed = changes.filter((c) => c.status === 'R').map((c) => c.file);
  const untracked = changes.filter((c) => c.status === '?').map((c) => c.file);

  const total = added.length + modified.length + deleted.length + renamed.length + untracked.length;

  let output = `=== CHANGE SUMMARY ===
Branch: ${branch}
Total: ${total} files
  - Added (A): ${added.length}
  - Modified (M): ${modified.length}
  - Deleted (D): ${deleted.length}
  - Renamed (R): ${renamed.length}
  - Untracked (?): ${untracked.length}

=== FILE TREE ===
`;

  if (modified.length > 0) {
    output += `\n--- Modified (${modified.length}) ---\n`;
    output += generateTreeSummary(modified, 'M', opts);
    output += '\n';
  }

  if (added.length > 0) {
    output += `\n--- Added (${added.length}) ---\n`;
    output += generateTreeSummary(added, 'A', opts);
    output += '\n';
  }

  if (deleted.length > 0) {
    output += `\n--- Deleted (${deleted.length}) ---\n`;
    output += generateTreeSummary(deleted, 'D', opts);
    output += '\n';
  }

  if (renamed.length > 0) {
    output += `\n--- Renamed (${renamed.length}) ---\n`;
    output += generateTreeSummary(renamed, 'R', opts);
    output += '\n';
  }

  if (untracked.length > 0) {
    output += `\n--- Untracked (${untracked.length}) ---\n`;
    output += generateTreeSummary(untracked, '?', opts);
    output += '\n';
  }

  return output;
}
