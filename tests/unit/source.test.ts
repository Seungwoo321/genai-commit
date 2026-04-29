import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadSourceContents } from '../../src/git/source.js';
import type { GitChange } from '../../src/types/git.js';

describe('loadSourceContents', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'genai-source-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function write(rel: string, body: string): Promise<void> {
    const full = path.join(tmpDir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, 'utf-8');
  }

  it('reads content for parseable changed files', async () => {
    await write('src/a.ts', `import { b } from './b';`);
    await write('src/b.ts', `export const b = 1;`);

    const changes: GitChange[] = [
      { file: 'src/a.ts', status: 'M' },
      { file: 'src/b.ts', status: 'M' },
    ];
    const contents = await loadSourceContents(changes, tmpDir);

    expect(contents.size).toBe(2);
    expect(contents.get('src/a.ts')).toContain('./b');
    expect(contents.get('src/b.ts')).toContain('export const b');
  });

  it('skips deleted files (no working-tree content)', async () => {
    await write('src/keep.ts', `export {};`);
    const changes: GitChange[] = [
      { file: 'src/keep.ts', status: 'M' },
      { file: 'src/gone.ts', status: 'D' },
    ];
    const contents = await loadSourceContents(changes, tmpDir);
    expect(contents.has('src/gone.ts')).toBe(false);
    expect(contents.has('src/keep.ts')).toBe(true);
  });

  it('skips files with unsupported extensions', async () => {
    await write('docs/README.md', `# hi`);
    await write('config/app.yaml', `key: value`);
    const changes: GitChange[] = [
      { file: 'docs/README.md', status: 'M' },
      { file: 'config/app.yaml', status: 'M' },
    ];
    const contents = await loadSourceContents(changes, tmpDir);
    expect(contents.size).toBe(0);
  });

  it('silently skips missing files instead of throwing', async () => {
    await write('src/exists.ts', `export {};`);
    const changes: GitChange[] = [
      { file: 'src/exists.ts', status: 'M' },
      { file: 'src/missing.ts', status: 'A' },
    ];
    const contents = await loadSourceContents(changes, tmpDir);
    expect(contents.has('src/exists.ts')).toBe(true);
    expect(contents.has('src/missing.ts')).toBe(false);
  });

  it('skips oversized files (graph treats them as singletons)', async () => {
    // 1.5 MiB > MAX_FILE_BYTES (1 MiB).
    await write('vendor/huge.js', 'x'.repeat(1_500_000));
    await write('src/normal.ts', `export {};`);
    const changes: GitChange[] = [
      { file: 'vendor/huge.js', status: 'M' },
      { file: 'src/normal.ts', status: 'M' },
    ];
    const contents = await loadSourceContents(changes, tmpDir);
    expect(contents.has('vendor/huge.js')).toBe(false);
    expect(contents.has('src/normal.ts')).toBe(true);
  });

  it('handles batches larger than the concurrency cap', async () => {
    // 120 files exceeds the internal READ_BATCH of 50, exercising the loop.
    const changes: GitChange[] = [];
    for (let i = 0; i < 120; i++) {
      const rel = `src/f${i}.ts`;
      await write(rel, `// file ${i}`);
      changes.push({ file: rel, status: 'M' });
    }
    const contents = await loadSourceContents(changes, tmpDir);
    expect(contents.size).toBe(120);
  });

  it('returns an empty map for an empty change list', async () => {
    const contents = await loadSourceContents([], tmpDir);
    expect(contents.size).toBe(0);
  });
});
