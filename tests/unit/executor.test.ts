import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, chmod } from 'node:fs/promises';
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

    expect(result.ok).toBe(false);
    expect(result.successCount).toBe(0);
    expect(result.failure?.index).toBe(0);
    expect(result.failure?.kind).toBe('staging');
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

  // Hook-rejection categorization + partial-batch retry.
  //
  // Regression for the "shown option does nothing" bug: when a pre-commit
  // hook rejected commit K mid-batch, commits 1..K-1 landed but
  // `executeCommits` reported only a boolean false. The loop's `[y]` retry
  // would re-run from commit 0, find nothing to stage (already committed),
  // and silently fail again. The new contract: surface a `hook` failure with
  // `successCount` so the loop can slice the retry and start from K.
  describe('hook rejection + partial-batch retry', () => {
    /**
     * Install a pre-commit hook driven by a persistent counter file:
     *
     *  - `'passThenFail'`: passes the first `n` invocations, rejects the rest.
     *  - `'failThenPass'`: rejects the first `n` invocations, passes the rest.
     *
     * The counter lives in the worktree so it survives across `executeCommits`
     * calls — that's the whole point of the retry test: the second call must
     * see the hook in its updated state.
     */
    async function installCountingHook(
      repoRoot: string,
      mode: 'passThenFail' | 'failThenPass',
      n: number
    ): Promise<void> {
      const counterPath = join(repoRoot, '.hook-counter');
      const hookPath = join(repoRoot, '.git/hooks/pre-commit');
      const failCond = mode === 'passThenFail' ? `[ $c -gt ${n} ]` : `[ $c -le ${n} ]`;
      const script =
        `#!/bin/sh\n` +
        `c=$(cat "${counterPath}" 2>/dev/null || echo 0)\n` +
        `c=$((c+1))\n` +
        `echo $c > "${counterPath}"\n` +
        `if ${failCond}; then\n` +
        `  echo "husky - pre-commit hook failed (code 1)" >&2\n` +
        `  exit 1\n` +
        `fi\n` +
        `exit 0\n`;
      await writeFile(hookPath, script);
      await chmod(hookPath, 0o755);
    }

    it('reports hook rejection with successCount of the commits that landed first', async () => {
      root = await initRepo();
      await writeFileIn(root, 'a.ts');
      await writeFileIn(root, 'b.ts');
      await isGitRepository(root);
      // Hook passes once (commit 1) then rejects (commit 2).
      await installCountingHook(root, 'passThenFail', 1);

      const result = await executeCommits([
        { files: ['a.ts'], title: 'feat: a', message: '' },
        { files: ['b.ts'], title: 'feat: b', message: '' },
      ]);

      expect(result.ok).toBe(false);
      expect(result.successCount).toBe(1);
      expect(result.failure?.index).toBe(1);
      expect(result.failure?.kind).toBe('hook');
      // init + the one commit that survived the hook.
      expect(await commitCount(root)).toBe(2);
    });

    it('lets a retry pick up from the failed commit when called with the remaining slice', async () => {
      root = await initRepo();
      await writeFileIn(root, 'a.ts');
      await writeFileIn(root, 'b.ts');
      await isGitRepository(root);
      // Reject the first attempt, accept everything afterwards.
      await installCountingHook(root, 'failThenPass', 1);

      const first = await executeCommits([
        { files: ['a.ts'], title: 'feat: a', message: '' },
        { files: ['b.ts'], title: 'feat: b', message: '' },
      ]);
      expect(first.ok).toBe(false);
      expect(first.successCount).toBe(0);
      expect(first.failure?.kind).toBe('hook');

      // Simulate the loop's retry path: slice off any landed commits (none
      // here) and re-run. The hook now passes for the remaining attempts.
      const remaining = [
        { files: ['a.ts'], title: 'feat: a', message: '' },
        { files: ['b.ts'], title: 'feat: b', message: '' },
      ].slice(first.successCount);

      const second = await executeCommits(remaining);
      expect(second.ok).toBe(true);
      expect(second.successCount).toBe(2);
      expect(await commitCount(root)).toBe(3); // init + a + b
    });

    it('reports a successful batch with ok=true and full successCount', async () => {
      root = await initRepo();
      await writeFileIn(root, 'a.ts');
      await writeFileIn(root, 'b.ts');
      await isGitRepository(root);

      const result = await executeCommits([
        { files: ['a.ts'], title: 'feat: a', message: '' },
        { files: ['b.ts'], title: 'feat: b', message: '' },
      ]);

      expect(result.ok).toBe(true);
      expect(result.successCount).toBe(2);
      expect(result.failure).toBeUndefined();
    });
  });
});
