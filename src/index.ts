#!/usr/bin/env node

import { Command } from 'commander';
import { mdToPdf } from 'md-to-pdf';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';

const program = new Command();

// Default configuration
const DEFAULT_INPUT_DIR = './markdown';
const DEFAULT_OUTPUT_DIR = './pdf';

interface ConversionOptions {
  input: string;
  output: string;
  file: boolean;
  recursive: boolean;
}

/**
 * Convert a single markdown file to PDF using md-to-pdf
 */
async function convertFile(
  inputPath: string,
  outputPath: string
): Promise<void> {
  try {
    console.log(chalk.blue(`Converting: ${inputPath}`));
    
    // Ensure output directory exists
    await fs.ensureDir(path.dirname(outputPath));
    
    // Use md-to-pdf for conversion with better code highlighting
    const pdf = await mdToPdf(
      { path: inputPath },
      {
        dest: outputPath,
        launch_options: {
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
          timeout: 60000
        },
        pdf_options: {
          format: 'A4',
          printBackground: true,
          margin: {
            top: '20mm',
            right: '20mm',
            bottom: '20mm',
            left: '20mm'
          }
        }
      }
    ).catch(console.error);
    
    if (pdf) {
      console.log(chalk.green(`✓ Created: ${outputPath}`));
    }
  } catch (error) {
    console.error(chalk.red(`✗ Error converting ${inputPath}:`), error);
    throw error;
  }
}

/**
 * Recursively find all markdown files in a directory
 */
async function findMarkdownFiles(
  dir: string,
  recursive: boolean = true
): Promise<string[]> {
  const files: string[] = [];
  
  if (!await fs.pathExists(dir)) {
    return files;
  }
  
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory() && recursive) {
      const subFiles = await findMarkdownFiles(fullPath, recursive);
      files.push(...subFiles);
    } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * Convert all markdown files in a directory to PDF
 */
async function convertDirectory(
  inputDir: string,
  outputDir: string,
  recursive: boolean = true
): Promise<void> {
  console.log(chalk.cyan(`\nScanning directory: ${inputDir}`));
  
  const markdownFiles = await findMarkdownFiles(inputDir, recursive);
  
  if (markdownFiles.length === 0) {
    console.log(chalk.yellow('No markdown files found.'));
    return;
  }
  
  console.log(chalk.cyan(`Found ${markdownFiles.length} markdown file(s)\n`));
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const inputFile of markdownFiles) {
    try {
      // Calculate relative path to preserve subfolder structure
      const relativePath = path.relative(inputDir, inputFile);
      const outputFile = path.join(
        outputDir,
        relativePath.replace(/\.(md|markdown)$/i, '.pdf')
      );
      
      await convertFile(inputFile, outputFile);
      successCount++;
    } catch (error) {
      errorCount++;
    }
  }
  
  console.log(chalk.cyan(`\nConversion complete:`));
  console.log(chalk.green(`  ✓ Success: ${successCount}`));
  if (errorCount > 0) {
    console.log(chalk.red(`  ✗ Errors: ${errorCount}`));
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  program
    .name('script-mark-pdf')
    .description('Convert markdown files to PDF')
    .version('1.0.0')
    .option('-i, --input <path>', `Input directory or file (default: ${DEFAULT_INPUT_DIR})`, DEFAULT_INPUT_DIR)
    .option('-o, --output <path>', `Output directory (default: ${DEFAULT_OUTPUT_DIR})`, DEFAULT_OUTPUT_DIR)
    .option('-f, --file', 'Convert a single file instead of a directory')
    .option('--no-recursive', 'Do not process subfolders')
    .parse(process.argv);

  const options = program.opts() as ConversionOptions;
  
  console.log(chalk.bold.cyan('\n=== Markdown to PDF Converter ===\n'));
  
  try {
    if (options.file) {
      // Single file conversion
      const inputPath = path.resolve(options.input);
      
      if (!await fs.pathExists(inputPath)) {
        console.error(chalk.red(`Error: File not found: ${inputPath}`));
        process.exit(1);
      }
      
      const outputPath = path.resolve(
        options.output,
        path.basename(inputPath).replace(/\.(md|markdown)$/i, '.pdf')
      );
      
      await convertFile(inputPath, outputPath);
    } else {
      // Directory conversion
      const inputDir = path.resolve(options.input);
      const outputDir = path.resolve(options.output);
      
      if (!await fs.pathExists(inputDir)) {
        console.error(chalk.red(`Error: Directory not found: ${inputDir}`));
        process.exit(1);
      }
      
      await convertDirectory(inputDir, outputDir, options.recursive);
    }
    
    console.log(chalk.green('\n✓ All conversions completed!\n'));
  } catch (error) {
    console.error(chalk.red('\n✗ Fatal error:'), error);
    process.exit(1);
  }
}

// Run the program
main();
