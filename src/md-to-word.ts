#!/usr/bin/env node

import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import * as puppeteer from 'puppeteer';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild
} from 'docx';

const DEFAULT_INPUT_DIR = './md';
const DEFAULT_OUTPUT_DIR = './word';

type MdNode = {
  type: string;
  depth?: number;
  value?: string;
  url?: string;
  ordered?: boolean;
  start?: number;
  spread?: boolean;
  children?: MdNode[];
  lang?: string;
  checked?: boolean | null;
  align?: Array<'left' | 'right' | 'center' | null>;
};

type CliOptions = {
  input: string;
  output: string;
  recursive: boolean;
};

// Global browser instance for mermaid rendering
let browserInstance: puppeteer.Browser | null = null;

async function initBrowser(): Promise<puppeteer.Browser> {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      headless: 'new' as puppeteer.PuppeteerLaunchOptions['headless'],
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browserInstance;
}

async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

async function renderMermaidToBuffer(mermaidCode: string): Promise<Buffer | null> {
  try {
    const browser = await initBrowser();
    const page = await browser.newPage();
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <style>
    body { margin: 0; padding: 20px; background: white; }
    .mermaid { display: flex; justify-content: center; }
  </style>
</head>
<body>
  <div class="mermaid">${mermaidCode}</div>
  <script>
    mermaid.initialize({ startOnLoad: true, theme: 'default' });
  </script>
</body>
</html>`;
    
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    // Wait for mermaid to render
    await page.waitForSelector('.mermaid svg', { timeout: 10000 });
    
    // Get the SVG element
    const svgElement = await page.$('.mermaid svg');
    if (!svgElement) {
      await page.close();
      return null;
    }
    
    // Take screenshot of the SVG
    const screenshot = await svgElement.screenshot({
      type: 'png',
      omitBackground: true
    });
    
    await page.close();
    return screenshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.yellow(`Warning: Failed to render mermaid diagram: ${message}`));
    return null;
  }
}

function normalizeCodeLine(line: string): string {
  const withExpandedTabs = line.replace(/\t/g, '    ');
  return withExpandedTabs.replace(/ /g, '\u00A0');
}

function textFromInline(node: MdNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') {
    return node.value ?? '';
  }

  if (!node.children || node.children.length === 0) {
    return '';
  }

  return node.children.map((child) => textFromInline(child)).join('');
}

type InlineStyle = {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
};

function renderInlineNodes(nodes: MdNode[] | undefined, style: InlineStyle = {}): ParagraphChild[] {
  if (!nodes || nodes.length === 0) {
    return [new TextRun({ text: '', ...style })];
  }

  const parts: ParagraphChild[] = [];

  for (const node of nodes) {
    if (node.type === 'text') {
      parts.push(new TextRun({ text: node.value ?? '', ...style }));
      continue;
    }

    if (node.type === 'strong') {
      parts.push(...renderInlineNodes(node.children, { ...style, bold: true }));
      continue;
    }

    if (node.type === 'emphasis') {
      parts.push(...renderInlineNodes(node.children, { ...style, italics: true }));
      continue;
    }

    if (node.type === 'delete') {
      parts.push(...renderInlineNodes(node.children, { ...style, strike: true }));
      continue;
    }

    if (node.type === 'inlineCode') {
      parts.push(
        new TextRun({
          text: normalizeCodeLine(node.value ?? ''),
          font: 'Consolas',
          ...style,
          shading: { fill: 'EFEFEF', type: ShadingType.CLEAR, color: 'auto' }
        })
      );
      continue;
    }

    if (node.type === 'break') {
      parts.push(new TextRun({ break: 1, text: '' }));
      continue;
    }

    if (node.type === 'link') {
      const label = textFromInline(node);
      parts.push(
        new ExternalHyperlink({
          link: node.url ?? '',
          children: [
            new TextRun({
              text: label,
              style: 'Hyperlink'
            })
          ]
        })
      );
      continue;
    }

      parts.push(new TextRun({ text: textFromInline(node), ...style }));
  }

  return parts.length > 0 ? parts : [new TextRun('')];
}

function mapHeadingLevel(depth: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (depth) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    case 4:
      return HeadingLevel.HEADING_4;
    case 5:
      return HeadingLevel.HEADING_5;
    default:
      return HeadingLevel.HEADING_6;
  }
}

function paragraphFromInline(children: MdNode[] | undefined, options: Partial<IParagraphOptions> = {}): Paragraph {
  return new Paragraph({
    children: renderInlineNodes(children),
    ...options
  });
}

function renderCodeBlock(node: MdNode): Paragraph[] {
  const source = node.value ?? '';
  const lines = source.split(/\r?\n/);
  const out: Paragraph[] = [];

  for (const line of lines) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: normalizeCodeLine(line),
            font: 'Consolas',
            size: 20
          })
        ],
        spacing: { before: 0, after: 0, line: 240 },
        shading: { fill: 'F7F7F7', type: ShadingType.CLEAR, color: 'auto' },
        border: {
          left: { style: BorderStyle.SINGLE, size: 8, color: 'D0D0D0' }
        },
        // The cast keeps compatibility across docx versions where wordWrap typing may vary.
        ...( { wordWrap: false } as unknown as Partial<IParagraphOptions> )
      })
    );
  }

  if (out.length === 0) {
    out.push(
      new Paragraph({
        children: [new TextRun({ text: '', font: 'Consolas' })],
        spacing: { before: 0, after: 0 }
      })
    );
  }

  return out;
}

async function renderMermaidBlock(node: MdNode): Promise<(Paragraph)[]> {
  const mermaidCode = node.value ?? '';
  const imageBuffer = await renderMermaidToBuffer(mermaidCode);
  
  if (!imageBuffer) {
    // Fallback to plain code block if rendering fails
    return renderCodeBlock(node);
  }
  
  const out: Paragraph[] = [];
  
  // Add the rendered image
  out.push(
    new Paragraph({
      children: [
        new ImageRun({
          data: imageBuffer,
          transformation: {
            width: 550,
            height: 350
          },
          type: 'png'
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 }
    })
  );
  
  return out;
}

function renderTable(node: MdNode): Table {
  const rows = node.children ?? [];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((rowNode, rowIndex) => {
      const cellNodes = rowNode.children ?? [];

      return new TableRow({
        tableHeader: rowIndex === 0,
        children: cellNodes.map((cellNode, cellIndex) => {
          const align = rowIndex > 0 ? node.align?.[cellIndex] : null;
          const paragraph = paragraphFromInline(cellNode.children, {
            alignment:
              align === 'center'
                ? AlignmentType.CENTER
                : align === 'right'
                  ? AlignmentType.RIGHT
                  : AlignmentType.LEFT
          });

          return new TableCell({
            children: [paragraph],
            shading:
              rowIndex === 0
                ? { fill: 'EDEDED', type: ShadingType.CLEAR, color: 'auto' }
                : undefined,
            margins: { top: 90, bottom: 90, left: 110, right: 110 },
            width: { size: 100 / Math.max(cellNodes.length, 1), type: WidthType.PERCENTAGE }
          });
        })
      });
    })
  });
}

function renderList(node: MdNode, depth = 0): Paragraph[] {
  const out: Paragraph[] = [];
  const items = node.children ?? [];
  const listRef = node.ordered ? 'ordered-rfc' : 'bullet-rfc';

  for (const item of items) {
    const itemChildren = item.children ?? [];
    const firstParagraph = itemChildren.find((child) => child.type === 'paragraph');
    const nested = itemChildren.filter((child) => child.type === 'list');
    const firstTextChildren = firstParagraph?.children ?? [];

    out.push(
      paragraphFromInline(firstTextChildren, {
        numbering: {
          reference: listRef,
          level: Math.min(depth, 8)
        }
      })
    );

    for (const nestedList of nested) {
      out.push(...renderList(nestedList, depth + 1));
    }
  }

  return out;
}

function renderBlockquote(node: MdNode): Paragraph[] {
  const out: Paragraph[] = [];
  const children = node.children ?? [];

  for (const child of children) {
    if (child.type === 'paragraph') {
      out.push(
        paragraphFromInline(child.children, {
          border: {
            left: { style: BorderStyle.SINGLE, size: 10, color: 'A0A0A0' }
          },
          indent: { left: 360 },
          spacing: { before: 120, after: 120 }
        })
      );
      continue;
    }

    if (child.type === 'code') {
      out.push(...renderCodeBlock(child));
      continue;
    }

    out.push(
      new Paragraph({
        children: [new TextRun(textFromInline(child))],
        indent: { left: 360 }
      })
    );
  }

  return out;
}

async function markdownAstToDocElements(root: MdNode): Promise<Array<Paragraph | Table>> {
  const output: Array<Paragraph | Table> = [];
  const nodes = root.children ?? [];

  for (const node of nodes) {
    if (node.type === 'heading') {
      output.push(
        paragraphFromInline(node.children, {
          heading: mapHeadingLevel(node.depth ?? 1),
          spacing: { before: 280, after: 140 }
        })
      );
      continue;
    }

    if (node.type === 'paragraph') {
      output.push(paragraphFromInline(node.children, { spacing: { after: 160 } }));
      continue;
    }

    if (node.type === 'code') {
      // Check if it's a mermaid diagram
      if (node.lang === 'mermaid') {
        output.push(...(await renderMermaidBlock(node)));
      } else {
        output.push(...renderCodeBlock(node));
      }
      output.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      continue;
    }

    if (node.type === 'list') {
      output.push(...renderList(node));
      output.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      continue;
    }

    if (node.type === 'blockquote') {
      output.push(...renderBlockquote(node));
      continue;
    }

    if (node.type === 'table') {
      output.push(renderTable(node));
      output.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      continue;
    }

    if (node.type === 'thematicBreak') {
      output.push(
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D0D0D0' } },
          spacing: { before: 180, after: 180 }
        })
      );
      continue;
    }
  }

  return output;
}

async function collectMarkdownFiles(rootDir: string, recursive: boolean): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = path.join(rootDir, entry.name);

    if (entry.isFile() && /\.md$/i.test(entry.name)) {
      files.push(absolute);
      continue;
    }

    if (entry.isDirectory() && recursive) {
      files.push(...(await collectMarkdownFiles(absolute, true)));
    }
  }

  return files;
}

export async function convertMarkdownFile(inputFile: string, outputFile: string): Promise<void> {
  const raw = await fs.readFile(inputFile, 'utf-8');
  const ast = unified().use(remarkParse).use(remarkGfm).parse(raw) as MdNode;

  const docElements = await markdownAstToDocElements(ast);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Calibri',
            size: 22
          },
          paragraph: {
            spacing: { line: 276, before: 0, after: 160 }
          }
        }
      }
    },
    numbering: {
      config: [
        {
          reference: 'bullet-rfc',
          levels: Array.from({ length: 9 }, (_, idx) => ({
            level: idx,
            format: 'bullet',
            text: idx % 3 === 0 ? '\u2022' : idx % 3 === 1 ? '\u25E6' : '\u25AA',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 720 + idx * 360, hanging: 360 } }
            }
          }))
        },
        {
          reference: 'ordered-rfc',
          levels: Array.from({ length: 9 }, (_, idx) => ({
            level: idx,
            format: 'decimal',
            text: `%${idx + 1}.`,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 720 + idx * 360, hanging: 360 } }
            }
          }))
        }
      ]
    },
    sections: [
      {
        children: docElements.length > 0 ? docElements : [new Paragraph({ text: '' })]
      }
    ]
  });

  await fs.ensureDir(path.dirname(outputFile));
  const outBuffer = await Packer.toBuffer(doc);
  await fs.writeFile(outputFile, outBuffer);
}

async function run(): Promise<void> {
  const program = new Command();

  program
    .name('md-to-word')
    .description('Convert md/**/*.md to word/**/*.docx preserving directory structure')
    .option('-i, --input <path>', `Input folder (default: ${DEFAULT_INPUT_DIR})`, DEFAULT_INPUT_DIR)
    .option('-o, --output <path>', `Output folder (default: ${DEFAULT_OUTPUT_DIR})`, DEFAULT_OUTPUT_DIR)
    .option('--no-recursive', 'Disable recursive directory traversal')
    .parse(process.argv);

  const options = program.opts<CliOptions>();
  const inputDir = path.resolve(options.input);
  const outputDir = path.resolve(options.output);

  if (!(await fs.pathExists(inputDir))) {
    throw new Error(`Input folder does not exist: ${inputDir}`);
  }

  const mdFiles = await collectMarkdownFiles(inputDir, options.recursive);
  if (mdFiles.length === 0) {
    console.log(chalk.yellow(`No .md files found in ${inputDir}`));
    return;
  }

  console.log(chalk.cyan(`Found ${mdFiles.length} markdown file(s).`));

  let ok = 0;
  let failed = 0;

  for (const mdFile of mdFiles) {
    const relative = path.relative(inputDir, mdFile);
    const outputFile = path.join(outputDir, relative.replace(/\.md$/i, '.docx'));

    try {
      console.log(chalk.blue(`Converting: ${relative}`));
      await convertMarkdownFile(mdFile, outputFile);
      ok++;
      console.log(chalk.green(`Created: ${path.relative(process.cwd(), outputFile)}`));
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Failed: ${relative}`));
      console.error(chalk.red(message));
    }
  }

  // Close the browser instance when done
  await closeBrowser();

  console.log(chalk.bold.cyan('\nConversion summary'));
  console.log(chalk.green(`Success: ${ok}`));
  if (failed > 0) {
    console.log(chalk.red(`Failed: ${failed}`));
    process.exitCode = 1;
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red('\nFatal error'));
  console.error(chalk.red(message));
  process.exit(1);
});
