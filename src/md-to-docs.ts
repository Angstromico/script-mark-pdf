#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { mdToPdf } from 'md-to-pdf';
import * as docx from 'docx';
import { marked, parse } from 'marked';

const program = new Command();

// Default configuration
const DEFAULT_INPUT_DIR = './md-files';
const DEFAULT_OUTPUT_DIR = './docs-files';

interface ConversionOptions {
  input: string;
  output: string;
  file: boolean;
  recursive: boolean;
}

/**
 * Convert markdown content to Word document
 */
async function markdownToDocx(markdownContent: string): Promise<docx.Document> {
  // Parse markdown to HTML
  const htmlContent = await marked(markdownContent);

  // Create a simple Word document with the content
  // For now, we'll put the HTML content as text (simplified approach)
  const plainText = markdownContent;

  return new docx.Document({
    sections: [{
      properties: {},
      children: [
        new docx.Paragraph({
          children: [
            new docx.TextRun({
              text: plainText,
              size: 24, // 12pt font
            }),
          ],
        }),
      ],
    }],
  });
}

/**
 * Convert a single markdown file to both PDF and DOCX
 */
async function convertMarkdownToDocs(
  inputPath: string,
  outputDir: string
): Promise<void> {
  try {
    console.log(chalk.blue(`Converting: ${inputPath}`));

    // Ensure output directory exists
    await fs.ensureDir(outputDir);

    const fileName = path.basename(inputPath, '.md');
    const pdfPath = path.join(outputDir, `${fileName}.pdf`);
    const docxPath = path.join(outputDir, `${fileName}.docx`);

    // Read markdown content
    const markdownContent = await fs.readFile(inputPath, 'utf-8');

    // Convert to PDF
    try {
      await mdToPdf(
        { content: markdownContent },
        { dest: pdfPath }
      );
      console.log(chalk.green(`  ✓ PDF: ${pdfPath}`));
    } catch (pdfError) {
      console.error(chalk.red(`  ✗ PDF failed: ${inputPath}`), pdfError);
    }

    // Convert to DOCX
    try {
      const doc = await markdownToDocx(markdownContent);
      const buffer = await docx.Packer.toBuffer(doc);
      await fs.writeFile(docxPath, buffer);
      console.log(chalk.green(`  ✓ DOCX: ${docxPath}`));
    } catch (docxError) {
      console.error(chalk.red(`  ✗ DOCX failed: ${inputPath}`), docxError);
    }

  } catch (error) {
    console.error(chalk.red(`✗ Error converting ${inputPath}:`), error);
    throw error;
  }
}

/**
 * Recursively find all markdown files in a directory
 */
async function findMarkdownFiles(dir: string, recursive: boolean = true): Promise<string[]> {
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
 * Convert all markdown files in a directory to both PDF and DOCX
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
      const relativeDir = path.dirname(relativePath);
      const outputSubDir = path.join(outputDir, relativeDir);

      await convertMarkdownToDocs(inputFile, outputSubDir);
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
async function main() {
  program
    .name('md-to-docs')
    .description('Convert Markdown files to both PDF and Word documents')
    .version('1.0.0')
    .option('-i, --input <path>', `Input directory or file (default: ${DEFAULT_INPUT_DIR})`, DEFAULT_INPUT_DIR)
    .option('-o, --output <path>', `Output directory (default: ${DEFAULT_OUTPUT_DIR})`, DEFAULT_OUTPUT_DIR)
    .option('-f, --file', 'Convert a single file instead of a directory')
    .option('--no-recursive', 'Do not process subfolders')
    .parse(process.argv);

  const options = program.opts() as ConversionOptions;

  console.log(chalk.bold.cyan('\n=== Markdown to Docs Converter ===\n'));
  console.log(chalk.yellow('Converts markdown files to both PDF and Word (.docx) formats\n'));

  try {
    if (options.file) {
      // Single file conversion
      const inputPath = path.resolve(options.input);

      if (!await fs.pathExists(inputPath)) {
        console.error(chalk.red(`Error: File not found: ${inputPath}`));
        process.exit(1);
      }

      if (!/\.(md|markdown)$/i.test(inputPath)) {
        console.error(chalk.red(`Error: File must be a markdown file: ${inputPath}`));
        process.exit(1);
      }

      const outputDir = path.resolve(options.output);
      await convertMarkdownToDocs(inputPath, outputDir);
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
