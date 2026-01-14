/**
 * Shell command execution utilities
 */

import { spawn } from 'child_process';

export interface ExecOptions {
  input?: string;
  timeout?: number;
  cwd?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute a command with optional input and timeout
 */
export async function execCommand(
  command: string,
  args: string[],
  options: ExecOptions = {}
): Promise<ExecResult> {
  const { input, timeout = 120000, cwd } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (!killed) {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 0,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    if (input) {
      proc.stdin.write(input);
      proc.stdin.end();
    }
  });
}

/**
 * Execute a command and return stdout only
 */
export async function execSimple(
  command: string,
  args: string[],
  options: ExecOptions = {}
): Promise<string> {
  const result = await execCommand(command, args, options);
  if (result.exitCode !== 0) {
    throw new Error(`Command failed with exit code ${result.exitCode}: ${result.stderr}`);
  }
  return result.stdout;
}
