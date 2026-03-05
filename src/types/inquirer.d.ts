declare module 'inquirer' {
  interface PromptQuestion {
    type: string;
    name: string;
    message: string;
    choices?: Array<{ value: string; name: string }>;
    default?: unknown;
  }

  interface Inquirer {
    prompt<T>(questions: PromptQuestion[]): Promise<T>;
  }

  const inquirer: Inquirer;
  export default inquirer;
}
