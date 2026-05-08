#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';

const program = new Command();

// Folders to clean
const FOLDERS_TO_CLEAN = [
  './markdown',
  './pdf',
  './word',
  './md',
  './md-files',
  './docs-files',
];

/**
 * Clean all files and subdirectories inside a folder
 */
async function cleanFolder(folderPath: string): Promise<void> {
  const absolutePath = path.resolve(folderPath);

  // Check if folder exists
  if (!await fs.pathExists(absolutePath)) {
    console.log(chalk.yellow(`⚠ Folder does not exist: ${folderPath}`));
    return;
  }

  // Check if it's actually a directory
  const stats = await fs.stat(absolutePath);
  if (!stats.isDirectory()) {
    console.log(chalk.yellow(`⚠ Not a directory: ${folderPath}`));
    return;
  }

  // Read all entries
  const entries = await fs.readdir(absolutePath);

  if (entries.length === 0) {
    console.log(chalk.gray(`  (already empty) ${folderPath}`));
    return;
  }

  // Delete each entry
  let deletedCount = 0;
  for (const entry of entries) {
    const entryPath = path.join(absolutePath, entry);
    try {
      await fs.remove(entryPath);
      deletedCount++;
    } catch (error) {
      console.log(chalk.red(`  ✗ Failed to delete: ${entry}`));
    }
  }

  console.log(chalk.green(`✓ Cleaned ${deletedCount} item(s) from ${folderPath}`));
}

/**
 * Main function
 */
async function main() {
  program
    .name('clean-folders')
    .description('Clean all files inside markdown/pdf/word/md/md-files/docs-folders directories')
    .version('1.0.0')
    .option('-f, --folders <folders>', 'Comma-separated list of specific folders to clean')
    .option('--dry-run', 'Show what would be deleted without actually deleting')
    .parse(process.argv);

  const options = program.opts();

  console.log(chalk.bold.cyan('\n=== Clean Folders ===\n'));

  const folders = options.folders
    ? options.folders.split(',').map((f: string) => f.trim())
    : FOLDERS_TO_CLEAN;

  if (options.dryRun) {
    console.log(chalk.yellow('DRY RUN - No files will be deleted\n'));
  }

  let cleanedCount = 0;

  for (const folder of folders) {
    const absolutePath = path.resolve(folder);

    if (!await fs.pathExists(absolutePath)) {
      console.log(chalk.yellow(`⚠ Folder does not exist: ${folder}`));
      continue;
    }

    const stats = await fs.stat(absolutePath);
    if (!stats.isDirectory()) {
      console.log(chalk.yellow(`⚠ Not a directory: ${folder}`));
      continue;
    }

    const entries = await fs.readdir(absolutePath);

    if (entries.length === 0) {
      console.log(chalk.gray(`  (already empty) ${folder}`));
      continue;
    }

    if (options.dryRun) {
      console.log(chalk.blue(`Would delete ${entries.length} item(s) from ${folder}:`));
      entries.forEach((entry) => {
        console.log(chalk.gray(`  - ${entry}`));
      });
    } else {
      await cleanFolder(folder);
      cleanedCount++;
    }
  }

  if (!options.dryRun) {
    console.log(chalk.green(`\n✓ Cleaning complete!`));
  }

  console.log();
}

// Run the program
main().catch((error) => {
  console.error(chalk.red('\n✗ Fatal error:'), error);
  process.exit(1);
});
