import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import { executeCommit, executeCommits } from '../../src/git/executor.js';
import { isGitRepository, getGit } from '../../src/git/status.js';

async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'genai-executor-'));
  const git = simpleGit(root);
  await git.init();
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test');
  await git.addConfig('commit.gpgsign', 'false');
  await git.commit(['init'], undefined, { '--allow-empty': null });
  return root;
}

async function writeFileIn(root: string, rel: string, content = 'x'): Promise<void> {
  const abs = join(root, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, content);
}

async function commitCount(root: string): Promise<number> {
  const log = await simpleGit(root).log();
  return log.total;
}

describe('executeCommit', () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('commits successfully when run from a subdirectory of the repo root', async () => {
    root = await initRepo();
    await writeFileIn(root, 'packages/pkg/src/a.ts');
    await writeFileIn(root, 'packages/pkg/src/b.ts');

    // Anchor getGit() at repo root while probing from a subdirectory
    const subdir = join(root, 'packages/pkg');
    const ok = await isGitRepository(subdir);
    expect(ok).toBe(true);

    const result = await executeCommit({
      files: ['packages/pkg/src/a.ts', 'packages/pkg/src/b.ts'],
      title: 'feat: add pkg',
      message: 'body',
    });

    expect(result).toBe(true);
    expect(await commitCount(root)).toBe(2); // init + new commit

    const staged = await simpleGit(root).raw(['show', 'HEAD', '--name-only', '--pretty=']);
    expect(staged).toContain('packages/pkg/src/a.ts');
    expect(staged).toContain('packages/pkg/src/b.ts');
  });

  it('returns false and creates no commit when every file fails to stage', async () => {
    root = await initRepo();
    await isGitRepository(root);

    const before = await commitCount(root);
    const result = await executeCommit({
      files: ['nonexistent/a.ts', 'nonexistent/b.ts'],
      title: 'feat: will fail',
      message: 'body',
    });

    expect(result).toBe(false);
    expect(await commitCount(root)).toBe(before); // no new commit
    expect(errSpy).toHaveBeenCalled();
    const errOutput = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(errOutput).toMatch(/No files were staged/);
  });

  it('commits only successfully staged files when some fail', async () => {
    root = await initRepo();
    await writeFileIn(root, 'real.ts');
    await isGitRepository(root);

    const result = await executeCommit({
      files: ['real.ts', 'nonexistent.ts'],
      title: 'feat: partial',
      message: 'body',
    });

    expect(result).toBe(true);
    expect(await commitCount(root)).toBe(2);

    const logOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logOutput).toMatch(/1 file\(s\) failed to stage/);

    const staged = await simpleGit(root).raw(['show', 'HEAD', '--name-only', '--pretty=']);
    expect(staged).toContain('real.ts');
    expect(staged).not.toContain('nonexistent.ts');
  });

  it('aborts without failure when the only listed file is .gitignore-matched and untracked', async () => {
    root = await initRepo();
    // .gitignore rule matches a new untracked file path. With the old code,
    // isIgnored() would return true via --no-index, then `git rm --cached`
    // would fail with "pathspec did not match any files" since the file is
    // not in the index. With --ignore-unmatch, that rm is a no-op; the
    // staged-file guard then aborts the commit cleanly.
    await writeFile(join(root, '.gitignore'), 'ignored/\n');
    await writeFileIn(root, 'ignored/foo.ts');
    await isGitRepository(root);

    const before = await commitCount(root);
    const result = await executeCommit({
      files: ['ignored/foo.ts'],
      title: 'feat: ignored only',
      message: 'body',
    });

    expect(result).toBe(false);
    expect(await commitCount(root)).toBe(before);
    const errOutput = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(errOutput).toMatch(/No files were staged/);
    // The rm path must not surface a pathspec error as a per-file warning
    const logOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logOutput).not.toMatch(/pathspec .* did not match any files/);
  });
});

describe('executeCommits', () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('aborts the remaining commits when an earlier one fails to stage anything', async () => {
    root = await initRepo();
    await writeFileIn(root, 'b.ts');
    await isGitRepository(root);

    const result = await executeCommits([
      { files: ['nonexistent.ts'], title: 'feat: first', message: 'x' },
      { files: ['b.ts'], title: 'feat: second', message: 'x' },
    ]);

    expect(result).toBe(false);
    expect(await commitCount(root)).toBe(1); // only init; neither commit ran
    const log = await simpleGit(root).log();
    expect(log.all.some((c) => c.message.includes('feat: second'))).toBe(false);
  });

  it('anchors getGit() at repo root after isGitRepository(subdir)', async () => {
    root = await initRepo();
    await writeFileIn(root, 'top.ts');

    const subdir = join(root, 'deep/nested');
    await mkdir(subdir, { recursive: true });
    await isGitRepository(subdir);

    // getGit() with no cwd should resolve pathspecs relative to repo root
    const git = getGit();
    await git.raw(['add', '-A', '--', 'top.ts']);
    const staged = (await git.raw(['diff', '--cached', '--name-only'])).trim();
    expect(staged).toBe('top.ts');
  });
});
