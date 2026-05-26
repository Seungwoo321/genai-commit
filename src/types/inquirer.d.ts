declare module 'inquirer' {
  interface PromptChoice {
    value: unknown;
    name: string;
  }

  interface PromptQuestion {
    type: string;
    name: string;
    message: string;
    choices?: PromptChoice[];
    default?: unknown;
    validate?: (
      input: string
    ) => boolean | string | Promise<boolean | string>;
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
