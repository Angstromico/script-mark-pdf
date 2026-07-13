#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import pdfParse from 'pdf-parse';
import {
  Document,
  Packer,
  Paragraph,
  TextRun
} from 'docx';

const program = new Command();

// Default configuration
const DEFAULT_INPUT_DIR = './pdf';
const DEFAULT_OUTPUT_DIR = './word';

interface CliOptions {
  input: string;
  output: string;
  file: boolean;
  recursive: boolean;
}

/**
 * Convert a single PDF file to Word by extracting text
 */
async function convertPdfToWord(inputPath: string, outputPath: string): Promise<void> {
  try {
    console.log(chalk.blue(`Converting: ${inputPath}`));

    // Ensure output directory exists
    await fs.ensureDir(path.dirname(outputPath));

    // Read PDF file
    const pdfBuffer = await fs.readFile(inputPath);

    // Extract text from PDF
    const pdfData = await pdfParse(pdfBuffer);

    // Create Word document with extracted text
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: pdfData.text,
                size: 24, // 12pt font
              }),
            ],
          }),
        ],
      }],
    });

    // Generate and save the document
    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(outputPath, buffer);

    console.log(chalk.green(`✓ Created: ${outputPath}`));
  } catch (error) {
    console.error(chalk.red(`✗ Error converting ${inputPath}:`), error);
    throw error;
  }
}

/**
 * Recursively find all PDF files in a directory
 */
async function findPdfFiles(dir: string, recursive: boolean = true): Promise<string[]> {
  const files: string[] = [];

  if (!await fs.pathExists(dir)) {
    return files;
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory() && recursive) {
      const subFiles = await findPdfFiles(fullPath, recursive);
      files.push(...subFiles);
    } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Convert all PDF files in a directory to Word
 */
async function convertDirectory(
  inputDir: string,
  outputDir: string,
  recursive: boolean = true
): Promise<void> {
  console.log(chalk.cyan(`\nScanning directory: ${inputDir}`));

  const pdfFiles = await findPdfFiles(inputDir, recursive);

  if (pdfFiles.length === 0) {
    console.log(chalk.yellow('No PDF files found.'));
    return;
  }

  console.log(chalk.cyan(`Found ${pdfFiles.length} PDF file(s)\n`));

  let successCount = 0;
  let errorCount = 0;

  for (const inputFile of pdfFiles) {
    try {
      // Calculate relative path to preserve subfolder structure
      const relativePath = path.relative(inputDir, inputFile);
      const outputFile = path.join(
        outputDir,
        relativePath.replace(/\.pdf$/i, '.docx')
      );

      await convertPdfToWord(inputFile, outputFile);
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
    .name('pdf-to-word')
    .description('Convert PDF files to Word documents')
    .version('1.0.0')
    .option('-i, --input <path>', `Input directory or file (default: ${DEFAULT_INPUT_DIR})`, DEFAULT_INPUT_DIR)
    .option('-o, --output <path>', `Output directory (default: ${DEFAULT_OUTPUT_DIR})`, DEFAULT_OUTPUT_DIR)
    .option('-f, --file', 'Convert a single file instead of a directory')
    .option('--no-recursive', 'Do not process subfolders')
    .parse(process.argv);

  const options = program.opts<CliOptions>();

  console.log(chalk.bold.cyan('\n=== PDF to Word Converter ===\n'));

  console.log(chalk.yellow('Note: This converter extracts text from PDF and creates a Word document.'));
  console.log(chalk.yellow('Formatting, images, and tables may not be preserved perfectly.\n'));

  try {
    if (options.file) {
      // Single file conversion
      const inputPath = path.resolve(options.input);

      if (!await fs.pathExists(inputPath)) {
        console.error(chalk.red(`Error: File not found: ${inputPath}`));
        process.exit(1);
      }

      if (!/\.pdf$/i.test(inputPath)) {
        console.error(chalk.red(`Error: File must be a PDF: ${inputPath}`));
        process.exit(1);
      }

      const outputPath = path.resolve(
        options.output,
        path.basename(inputPath).replace(/\.pdf$/i, '.docx')
      );

      await convertPdfToWord(inputPath, outputPath);
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
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red('\n✗ Fatal error:'), message);
  process.exit(1);
});
