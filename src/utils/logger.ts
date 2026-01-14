/**
 * Colored console output utilities
 */

import chalk from 'chalk';

export const logger = {
  info: (message: string) => console.log(chalk.cyan(message)),
  success: (message: string) => console.log(chalk.green(message)),
  warning: (message: string) => console.log(chalk.yellow(message)),
  error: (message: string) => console.error(chalk.red(message)),
  highlight: (message: string) => console.log(chalk.magenta(message)),
  dim: (message: string) => console.log(chalk.dim(message)),
};

export const colors = {
  red: chalk.red,
  green: chalk.green,
  yellow: chalk.yellow,
  cyan: chalk.cyan,
  blue: chalk.blue,
  magenta: chalk.magenta,
  dim: chalk.dim,
  bold: chalk.bold,
};
