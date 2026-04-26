declare module 'inquirer' {
  interface PromptQuestion {
    type: string;
    name: string;
    message: string;
    choices?: Array<{ value: string; name: string }>;
    default?: unknown;
  }

  interface PromptModule {
    <T>(questions: PromptQuestion[]): Promise<T> & { ui?: unknown };
  }

  interface Inquirer {
    prompt: PromptModule;
    createPromptModule(opts?: {
      input?: NodeJS.ReadableStream;
      output?: NodeJS.WritableStream;
      skipTTYChecks?: boolean;
    }): PromptModule;
  }

  const inquirer: Inquirer;
  export default inquirer;
}
