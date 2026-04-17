#!/usr/bin/env node

import { Command } from 'commander';
import { marked } from 'marked';
import puppeteer from 'puppeteer';
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
  individual: boolean;
  recursive: boolean;
}

// HTML template for PDF generation
const HTML_TEMPLATE = (content: string, title: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      line-height: 1.6;
      color: #333;
    }
    h1, h2, h3, h4, h5, h6 {
      color: #2c3e50;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
    }
    h1 { border-bottom: 2px solid #eee; padding-bottom: 0.3em; }
    code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
    }
    pre {
      background: #f4f4f4;
      padding: 16px;
      border-radius: 5px;
      overflow-x: auto;
    }
    pre code {
      background: none;
      padding: 0;
    }
    blockquote {
      border-left: 4px solid #ddd;
      padding-left: 16px;
      margin-left: 0;
      color: #666;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px 12px;
      text-align: left;
    }
    th {
      background: #f4f4f4;
    }
    a {
      color: #3498db;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    img {
      max-width: 100%;
      height: auto;
    }
  </style>
</head>
<body>
  ${content}
</body>
</html>
`;

/**
 * Convert markdown content to HTML
 */
async function markdownToHtml(markdown: string): Promise<string> {
  return await marked(markdown);
}

/**
 * Convert HTML to PDF using Puppeteer
 */
async function htmlToPdf(html: string, outputPath: string): Promise<void> {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '20px',
      right: '20px',
      bottom: '20px',
      left: '20px'
    }
  });
  
  await browser.close();
}

/**
 * Convert a single markdown file to PDF
 */
async function convertFile(
  inputPath: string,
  outputPath: string
): Promise<void> {
  try {
    console.log(chalk.blue(`Converting: ${inputPath}`));
    
    const markdown = await fs.readFile(inputPath, 'utf-8');
    const htmlContent = await markdownToHtml(markdown);
    const title = path.basename(inputPath, path.extname(inputPath));
    const html = HTML_TEMPLATE(htmlContent, title);
    
    // Ensure output directory exists
    await fs.ensureDir(path.dirname(outputPath));
    
    await htmlToPdf(html, outputPath);
    console.log(chalk.green(`✓ Created: ${outputPath}`));
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
    if (options.individual) {
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
