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
  alt?: string;
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

export async function closeBrowser(): Promise<void> {
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

function getPngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  if (!isPng) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

function getJpegSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4) return null;
  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;

  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xFF) return null;

    // Skip padding 0xFFs
    while (buffer[offset] === 0xFF) {
      offset++;
    }

    const marker = buffer[offset];
    offset++;

    if (marker === 0xD9) { // EOI
      return null;
    }

    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);

    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
      if (offset + 8 > buffer.length) return null;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return { width, height };
    }

    offset += length;
  }
  return null;
}

async function renderInlineNodes(
  nodes: MdNode[] | undefined,
  style: InlineStyle = {},
  baseDir: string
): Promise<ParagraphChild[]> {
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
      parts.push(...(await renderInlineNodes(node.children, { ...style, bold: true }, baseDir)));
      continue;
    }

    if (node.type === 'emphasis') {
      parts.push(...(await renderInlineNodes(node.children, { ...style, italics: true }, baseDir)));
      continue;
    }

    if (node.type === 'delete') {
      parts.push(...(await renderInlineNodes(node.children, { ...style, strike: true }, baseDir)));
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

    if (node.type === 'image') {
      const imgUrl = node.url ?? '';
      const imgPath = path.resolve(baseDir, imgUrl);

      if (await fs.pathExists(imgPath)) {
        try {
          const imgBuffer = await fs.readFile(imgPath);
          const ext = path.extname(imgPath).toLowerCase().replace('.', '');

          let width = 300;
          let height = 200;
          const size = getPngSize(imgBuffer) || getJpegSize(imgBuffer);
          if (size) {
            width = size.width;
            height = size.height;
          }

          const maxWidth = 500;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }

          parts.push(
            new ImageRun({
              data: imgBuffer,
              transformation: {
                width,
                height
              },
              type: ext === 'jpg' || ext === 'jpeg' ? 'jpg' : 'png'
            })
          );
          continue;
        } catch (err) {
          console.warn(chalk.yellow(`Warning: Failed to load image ${imgPath}: ${err}`));
        }
      } else {
        console.warn(chalk.yellow(`Warning: Image file not found: ${imgPath}`));
      }

      parts.push(new TextRun({ text: node.alt || node.value || imgUrl, ...style }));
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

async function paragraphFromInline(
  children: MdNode[] | undefined,
  options: Partial<IParagraphOptions> = {},
  baseDir: string
): Promise<Paragraph> {
  return new Paragraph({
    children: await renderInlineNodes(children, {}, baseDir),
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

async function renderTable(node: MdNode, baseDir: string): Promise<Table> {
  const rows = node.children ?? [];

  const tableRows = await Promise.all(
    rows.map(async (rowNode, rowIndex) => {
      const cellNodes = rowNode.children ?? [];

      const cells = await Promise.all(
        cellNodes.map(async (cellNode, cellIndex) => {
          const align = rowIndex > 0 ? node.align?.[cellIndex] : null;
          const paragraph = await paragraphFromInline(cellNode.children, {
            alignment:
              align === 'center'
                ? AlignmentType.CENTER
                : align === 'right'
                  ? AlignmentType.RIGHT
                  : align === 'left'
                    ? AlignmentType.LEFT
                    : undefined
          }, baseDir);

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
      );

      return new TableRow({
        tableHeader: rowIndex === 0,
        children: cells
      });
    })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: tableRows
  });
}

async function renderList(node: MdNode, depth = 0, baseDir: string): Promise<Paragraph[]> {
  const out: Paragraph[] = [];
  const items = node.children ?? [];
  const listRef = node.ordered ? 'ordered-rfc' : 'bullet-rfc';

  for (const item of items) {
    const itemChildren = item.children ?? [];
    const firstParagraph = itemChildren.find((child) => child.type === 'paragraph');
    const nested = itemChildren.filter((child) => child.type === 'list');
    const firstTextChildren = firstParagraph?.children ?? [];

    out.push(
      await paragraphFromInline(firstTextChildren, {
        numbering: {
          reference: listRef,
          level: Math.min(depth, 8)
        }
      }, baseDir)
    );

    for (const nestedList of nested) {
      out.push(...(await renderList(nestedList, depth + 1, baseDir)));
    }
  }

  return out;
}

async function renderBlockquote(node: MdNode, baseDir: string): Promise<Paragraph[]> {
  const out: Paragraph[] = [];
  const children = node.children ?? [];

  for (const child of children) {
    if (child.type === 'paragraph') {
      out.push(
        await paragraphFromInline(child.children, {
          border: {
            left: { style: BorderStyle.SINGLE, size: 10, color: 'A0A0A0' }
          },
          indent: { left: 360 },
          spacing: { before: 120, after: 120 }
        }, baseDir)
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

async function markdownAstToDocElements(root: MdNode, baseDir: string): Promise<Array<Paragraph | Table>> {
  const output: Array<Paragraph | Table> = [];
  const nodes = root.children ?? [];

  for (const node of nodes) {
    if (node.type === 'heading') {
      output.push(
        await paragraphFromInline(node.children, {
          heading: mapHeadingLevel(node.depth ?? 1),
          spacing: { before: 280, after: 140 }
        }, baseDir)
      );
      continue;
    }

    if (node.type === 'paragraph') {
      output.push(await paragraphFromInline(node.children, { spacing: { after: 160 } }, baseDir));
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
      output.push(...(await renderList(node, 0, baseDir)));
      output.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      continue;
    }

    if (node.type === 'blockquote') {
      output.push(...(await renderBlockquote(node, baseDir)));
      continue;
    }

    if (node.type === 'table') {
      output.push(await renderTable(node, baseDir));
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
  const baseDir = path.dirname(inputFile);

  const docElements = await markdownAstToDocElements(ast, baseDir);

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
