/**
 * Jira-based commit merging
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import type { Commit } from '../types/commit.js';
import type { AIProvider } from '../providers/types.js';
import type { GencoConfig } from '../config/types.js';
import { extractJiraKeys, formatJiraKeys } from './extractor.js';
import { logger } from '../utils/logger.js';

export interface JiraAssignment {
  commitIndex: number;
  jiraKeys: string[];
}

/**
 * Prompt user to assign Jira tickets to each commit
 */
async function promptJiraAssignments(commits: Commit[]): Promise<JiraAssignment[]> {
  console.log(`\n${chalk.blue('=== Assign Jira Tickets ===')}`);
  console.log(chalk.yellow('Enter Jira URL for each commit (press Enter to skip):\n'));

  const assignments: JiraAssignment[] = [];

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];

    console.log(`${chalk.cyan(`[${i + 1}/${commits.length}]`)} ${chalk.green(commit.title)}`);
    console.log(`    Files: ${commit.files.join(', ')}`);
    console.log(`    Message: ${commit.message}`);

    const { jiraUrl } = await inquirer.prompt<{ jiraUrl: string }>([
      {
        type: 'input',
        name: 'jiraUrl',
        message: 'Jira URL>',
      },
    ]);

    if (jiraUrl.trim()) {
      const keys = extractJiraKeys(jiraUrl);
      if (keys.length > 0) {
        assignments.push({ commitIndex: i, jiraKeys: keys });
        console.log(chalk.green(`  -> ${formatJiraKeys(keys)}`));
      } else {
        console.log(chalk.red('  Could not extract Jira key from URL. Skipped.'));
        assignments.push({ commitIndex: i, jiraKeys: [] });
      }
    } else {
      console.log(chalk.yellow('  -> Skipped'));
      assignments.push({ commitIndex: i, jiraKeys: [] });
    }

    console.log('');
  }

  return assignments;
}

/**
 * Find duplicate Jira keys across assignments
 */
function findDuplicateKeys(assignments: JiraAssignment[]): string[] {
  const keyCount = new Map<string, number>();

  for (const assignment of assignments) {
    for (const key of assignment.jiraKeys) {
      keyCount.set(key, (keyCount.get(key) ?? 0) + 1);
    }
  }

  return [...keyCount.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
}

/**
 * Merge commits with the same Jira key using AI
 */
async function mergeCommitsWithAI(
  commitsToMerge: Commit[],
  jiraKey: string,
  provider: AIProvider,
  config: GencoConfig
): Promise<Commit> {
  const allFiles = [...new Set(commitsToMerge.flatMap((c) => c.files))];

  const mergeInput = `TITLE_LANG: ${config.titleLang}
MESSAGE_LANG: ${config.messageLang}
JIRA_KEY: ${jiraKey}

Merge these commits into ONE commit. Add (${jiraKey}) at the end of the title.
Keep all files combined. Summarize messages.

Commits to merge:
${commitsToMerge
  .map(
    (c) =>
      `- Title: ${c.title}\n  Files: ${c.files.join(', ')}\n  Message: ${c.message}\n`
  )
  .join('\n')}

Combined files: ${allFiles.join(', ')}`;

  const response = await provider.generate(mergeInput, 'regroup');
  const result = provider.parseResponse(response);

  if (result.commits.length > 0) {
    return {
      ...result.commits[0],
      jiraKey,
    };
  }

  // Fallback: manual merge
  return {
    files: allFiles,
    title: `${commitsToMerge[0].title} (${jiraKey})`,
    message: commitsToMerge.map((c) => c.message).join(' '),
    jiraKey,
  };
}

/**
 * Process Jira ticket assignments and merge commits if needed
 */
export async function processJiraTickets(
  commits: Commit[],
  provider: AIProvider,
  config: GencoConfig
): Promise<Commit[]> {
  const assignments = await promptJiraAssignments(commits);

  // Find duplicate Jira keys
  const duplicateKeys = findDuplicateKeys(assignments);

  if (duplicateKeys.length > 0) {
    for (const key of duplicateKeys) {
      const count = assignments.filter((a) => a.jiraKeys.includes(key)).length;
      console.log(chalk.magenta(`Duplicate found: ${key} (${count} commits)`));
    }
  }

  // Process commits
  if (duplicateKeys.length > 0) {
    console.log(`\n${chalk.cyan('Merging commits with same Jira ticket...')}`);

    const result: Commit[] = [];
    const processedIndices = new Set<number>();

    // Merge commits with duplicate keys
    for (const dupKey of duplicateKeys) {
      const indicesToMerge = assignments
        .filter((a) => a.jiraKeys.includes(dupKey))
        .map((a) => a.commitIndex);

      const commitsToMerge = indicesToMerge.map((i) => commits[i]);
      indicesToMerge.forEach((i) => processedIndices.add(i));

      const spinner = ora(`Merging commits for ${dupKey}...`).start();

      try {
        const merged = await mergeCommitsWithAI(commitsToMerge, dupKey, provider, config);
        result.push(merged);
        spinner.succeed(`Merged into: ${merged.title}`);
      } catch (error) {
        spinner.fail(`Failed to merge: ${error}`);
        // Add original commits as fallback
        commitsToMerge.forEach((c) => result.push({ ...c, jiraKey: dupKey }));
      }
    }

    // Add non-duplicate commits
    commits.forEach((commit, i) => {
      if (!processedIndices.has(i)) {
        const assignment = assignments.find((a) => a.commitIndex === i);
        if (assignment && assignment.jiraKeys.length > 0) {
          const keyStr = formatJiraKeys(assignment.jiraKeys);
          result.push({
            ...commit,
            title: `${commit.title} (${keyStr})`,
            jiraKey: keyStr,
          });
        } else {
          result.push(commit);
        }
      }
    });

    return result;
  } else {
    // No duplicates - just add Jira keys to titles
    console.log(`\n${chalk.green('No duplicates. Adding Jira keys to titles...')}`);

    return commits.map((commit, i) => {
      const assignment = assignments.find((a) => a.commitIndex === i);
      if (assignment && assignment.jiraKeys.length > 0) {
        const keyStr = formatJiraKeys(assignment.jiraKeys);
        console.log(chalk.green(`  [${i + 1}] ${commit.title} (${keyStr})`));
        return {
          ...commit,
          title: `${commit.title} (${keyStr})`,
          jiraKey: keyStr,
        };
      }
      return commit;
    });
  }
}
