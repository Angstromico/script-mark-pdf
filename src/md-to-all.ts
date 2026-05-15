#!/usr/bin/env node

import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import { convertMarkdownFile } from './md-to-word';
import { convertFile } from './index';

const DEFAULT_INPUT_DIR = './md-files';
const DEFAULT_OUTPUT_DIR = './docs-files';

async function findMarkdownFiles(dir: string, recursive: boolean = true): Promise<string[]> {
  const files: string[] = [];
  if (!await fs.pathExists(dir)) return files;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      files.push(...(await findMarkdownFiles(fullPath, recursive)));
    } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function run(): Promise<void> {
  const program = new Command();
  program
    .name('md-to-all')
    .description('Convert Markdown files to both PDF and Word')
    .option('-i, --input <path>', `Input directory (default: ${DEFAULT_INPUT_DIR})`, DEFAULT_INPUT_DIR)
    .option('-o, --output <path>', `Output directory (default: ${DEFAULT_OUTPUT_DIR})`, DEFAULT_OUTPUT_DIR)
    .parse(process.argv);

  const options = program.opts();
  const inputDir = path.resolve(options.input);
  const outputDir = path.resolve(options.output);

  if (!(await fs.pathExists(inputDir))) {
    console.error(chalk.red(`Input folder does not exist: ${inputDir}`));
    process.exit(1);
  }

  const mdFiles = await findMarkdownFiles(inputDir);
  console.log(chalk.cyan(`Found ${mdFiles.length} files.`));

  for (const mdFile of mdFiles) {
    const relative = path.relative(inputDir, mdFile);
    const pdfOutput = path.join(outputDir, relative.replace(/\.md$/i, '.pdf'));
    const docxOutput = path.join(outputDir, relative.replace(/\.md$/i, '.docx'));

    console.log(chalk.blue(`Processing: ${relative}`));
    
    await fs.ensureDir(path.dirname(pdfOutput));

    try {
      await convertFile(mdFile, pdfOutput);
      console.log(chalk.green(`  Created: ${path.basename(pdfOutput)}`));
    } catch (e) {
      console.error(chalk.red(`  PDF failed: ${e}`));
    }

    try {
      await convertMarkdownFile(mdFile, docxOutput);
      console.log(chalk.green(`  Created: ${path.basename(docxOutput)}`));
    } catch (e) {
      console.error(chalk.red(`  Word failed: ${e}`));
    }
  }
}

run().catch(console.error);
