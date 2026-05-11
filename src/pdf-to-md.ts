#!/usr/bin/env node

import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';

// pdfjs-dist v3 legacy CJS build (works with Node + tsconfig commonjs).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const DEFAULT_INPUT_DIR = './pdf';
const DEFAULT_OUTPUT_DIR = './md';

// ---------- types ----------

interface RawItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

interface LineSegment {
  text: string;
  x: number;
  width: number;
  fontName: string;
  isMono: boolean;
  isBold: boolean;
  isItalic: boolean;
  height: number;
}

interface Line {
  y: number;
  height: number;
  segments: LineSegment[];
  text: string; // pre-joined text
  startX: number;
  isMonoLine: boolean;
  pageIndex: number;
}

interface FontInfo {
  name: string;
  isMono: boolean;
  isBold: boolean;
  isItalic: boolean;
}

interface CliOptions {
  input: string;
  output: string;
  file: boolean;
  recursive: boolean;
}

// ---------- font helpers ----------

const MONO_HINTS = [
  'mono', 'courier', 'consolas', 'menlo', 'cousine', 'inconsolata',
  'fira code', 'firacode', 'sourcecode', 'source code', 'roboto mono',
  'jetbrains', 'ubuntu mono', 'andale', 'lucida console', 'andalemono',
  'liberation mono', 'dejavusansmono', 'dejavu sans mono', 'overpass mono'
];

function classifyFont(fontName: string, fontDict: Map<string, FontInfo>): FontInfo {
  const cached = fontDict.get(fontName);
  if (cached) return cached;

  const lower = fontName.toLowerCase();
  const isMono = MONO_HINTS.some((hint) => lower.includes(hint));
  const isBold = /bold|black|heavy|semibold/.test(lower);
  const isItalic = /italic|oblique/.test(lower);
  const info: FontInfo = { name: fontName, isMono, isBold, isItalic };
  fontDict.set(fontName, info);
  return info;
}

// ---------- text extraction ----------

async function extractLinesFromPdf(buffer: Buffer): Promise<{ lines: Line[]; fontDict: Map<string, FontInfo> }> {
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0
  });
  const pdf = await loadingTask.promise;

  const fontDict = new Map<string, FontInfo>();
  const allLines: Line[] = [];

  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
    const page = await pdf.getPage(pageIndex + 1);
    const content = await page.getTextContent({
      includeMarkedContent: false
    });

    const rawItems: RawItem[] = [];
    for (const item of content.items as Array<any>) {
      // TextItem has transform=[a,b,c,d,e,f] -> (e,f) is position; (d) is font height
      if (typeof item.str !== 'string') continue;
      const t = item.transform || [1, 0, 0, 1, 0, 0];
      rawItems.push({
        str: item.str,
        x: t[4],
        y: t[5],
        width: item.width || 0,
        height: item.height || Math.abs(t[3]) || 10,
        fontName: item.fontName || '',
        hasEOL: !!item.hasEOL
      });
    }

    // Group items into lines using a y-tolerance based on item height
    // Sort first by y descending (top-to-bottom in PDF coordinates), then by x ascending
    rawItems.sort((a, b) => (b.y - a.y) || (a.x - b.x));

    const lineGroups: RawItem[][] = [];
    for (const item of rawItems) {
      const tolerance = Math.max(2, item.height * 0.5);
      const last = lineGroups[lineGroups.length - 1];
      if (last && Math.abs(last[0].y - item.y) <= tolerance) {
        last.push(item);
      } else {
        lineGroups.push([item]);
      }
    }

    for (const group of lineGroups) {
      group.sort((a, b) => a.x - b.x);
      const segments: LineSegment[] = [];

      // Merge contiguous items with the same font into segments,
      // injecting spaces when there is a horizontal gap between items.
      for (const item of group) {
        if (item.str === '') continue;
        const fontInfo = classifyFont(item.fontName, fontDict);
        const last = segments[segments.length - 1];
        let text = item.str;

        if (last) {
          const gap = item.x - (last.x + last.width);
          // estimate avg char width using last segment width / chars
          const avgChar = last.text.length > 0 ? last.width / last.text.length : item.height * 0.5;
          if (gap > avgChar * 0.4) {
            const spaces = Math.max(1, Math.round(gap / Math.max(avgChar, 1)));
            // For mono, preserve indentation using literal spaces in segment.
            text = ' '.repeat(spaces) + text;
          }
        }

        if (
          last &&
          last.fontName === item.fontName &&
          last.isMono === fontInfo.isMono &&
          last.isBold === fontInfo.isBold &&
          last.isItalic === fontInfo.isItalic
        ) {
          last.text += text;
          last.width = item.x + item.width - last.x;
        } else {
          segments.push({
            text,
            x: item.x,
            width: item.width,
            fontName: item.fontName,
            isMono: fontInfo.isMono,
            isBold: fontInfo.isBold,
            isItalic: fontInfo.isItalic,
            height: item.height
          });
        }
      }

      if (segments.length === 0) continue;

      const text = segments.map((s) => s.text).join('');
      if (text.trim() === '' && !segments.some((s) => s.isMono)) continue;

      const isMonoLine = segments.length > 0 && segments.every((s) => s.isMono || s.text.trim() === '');
      const lineHeight = Math.max(...segments.map((s) => s.height));
      const startX = group[0]?.x ?? 0;

      allLines.push({
        y: group[0].y,
        height: lineHeight,
        segments,
        text,
        startX,
        isMonoLine,
        pageIndex
      });
    }
  }

  return { lines: allLines, fontDict };
}

// ---------- markdown formatting ----------

function escapeInlineMd(text: string): string {
  // Avoid double escaping: only escape the most disruptive markdown chars in body text.
  return text
    .replace(/\\/g, '\\\\')
    .replace(/([*_`<>\[\]])/g, '\\$1');
}

function renderInlineSegments(segments: LineSegment[]): string {
  // Render with bold/italic/inline-code formatting.
  // Group adjacent runs with same style to reduce noise.
  const out: string[] = [];

  for (const seg of segments) {
    const raw = seg.text;
    if (raw === '') continue;

    if (seg.isMono) {
      // Inline code; collapse to backticks. Choose backtick fence that doesn't collide.
      const trimmed = raw.replace(/\s+$/g, '').replace(/^\s+/g, ' ');
      if (trimmed === '') {
        out.push(' ');
        continue;
      }
      const fence = trimmed.includes('`') ? '``' : '`';
      const sep = trimmed.includes('``') ? '```' : fence;
      out.push(`${sep}${trimmed}${sep}`);
      continue;
    }

    let txt = escapeInlineMd(raw);
    if (seg.isBold && seg.isItalic) txt = `***${txt.trim()}***${txt.endsWith(' ') ? ' ' : ''}`;
    else if (seg.isBold) txt = `**${txt.trim()}**${txt.endsWith(' ') ? ' ' : ''}`;
    else if (seg.isItalic) txt = `*${txt.trim()}*${txt.endsWith(' ') ? ' ' : ''}`;

    out.push(txt);
  }

  return out.join('').replace(/\s+\n/g, '\n');
}

// ---------- structural detectors ----------

const HR_REGEX = /^[\s\u2014\u2013\-_=*]{6,}$/;
const BULLET_REGEX = /^([\u2022\u25E6\u25AA\u25CF\u25CB\u2043\u2219\-*+])\s+/;
const NUMBERED_REGEX = /^(\d{1,3})[.)]\s+/;

function detectListItem(text: string): { kind: 'ul' | 'ol' | null; rest: string; ordinal?: string } {
  const trimmed = text.replace(/^\s+/, '');
  const bMatch = trimmed.match(BULLET_REGEX);
  if (bMatch) return { kind: 'ul', rest: trimmed.slice(bMatch[0].length) };

  const nMatch = trimmed.match(NUMBERED_REGEX);
  if (nMatch) return { kind: 'ol', rest: trimmed.slice(nMatch[0].length), ordinal: nMatch[1] };

  return { kind: null, rest: text };
}

function isHorizontalRule(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  return HR_REGEX.test(t);
}

function computeBodyHeight(lines: Line[]): number {
  // Most common (mode) line height, ignoring monospace lines.
  const buckets = new Map<number, number>();
  for (const line of lines) {
    if (line.isMonoLine) continue;
    const key = Math.round(line.height * 2) / 2;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  let bestKey = 10;
  let bestCount = 0;
  for (const [k, v] of buckets) {
    if (v > bestCount) {
      bestCount = v;
      bestKey = k;
    }
  }
  return bestKey;
}

function headingDepth(lineHeight: number, bodyHeight: number): number {
  if (bodyHeight <= 0) return 0;
  const ratio = lineHeight / bodyHeight;
  if (ratio >= 1.85) return 1;
  if (ratio >= 1.55) return 2;
  if (ratio >= 1.32) return 3;
  if (ratio >= 1.16) return 4;
  return 0; // not a heading
}

// ---------- table detection ----------

interface ColumnSpec {
  starts: number[];
}

function detectColumnsFromGroup(group: Line[]): ColumnSpec | null {
  // For each line, derive segment x-starts (split text by 2+ whitespace gaps).
  const linesStarts: number[][] = group.map((line) => {
    const starts: number[] = [];
    let cursor = line.startX;
    for (const seg of line.segments) {
      // Split segment text by 2+ spaces to find sub-columns
      const parts = seg.text.split(/ {2,}|\t+/);
      let acc = cursor;
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].trim() !== '' || i === 0) {
          if (i === 0 && acc !== cursor) starts.push(acc);
          else if (i > 0) {
            // add a starting offset roughly proportional. Without exact x, skip precise math.
            starts.push(acc + i);
          } else {
            starts.push(acc);
          }
        }
      }
      cursor = acc + 1;
    }
    return starts;
  });

  // Heuristic: if all lines have ≥2 cells (split by 2+ spaces), treat as table.
  const cellCounts = group.map((line) => splitCellsByGap(line).length);
  const minCells = Math.min(...cellCounts);
  const maxCells = Math.max(...cellCounts);
  if (minCells >= 2 && maxCells >= 2) {
    return { starts: [0] };
  }
  return null;
}

function splitCellsByGap(line: Line): string[] {
  // Use raw text and split by 2+ spaces to detect columns produced from x-gap injection.
  const cells = line.text.split(/ {2,}/).map((c) => c.trim()).filter((c) => c.length > 0);
  return cells;
}

function renderTable(rows: Line[]): string[] {
  const matrix = rows.map((row) => splitCellsByGap(row));
  const colCount = Math.max(...matrix.map((r) => r.length));

  // Normalize each row to the same column count
  const normalized = matrix.map((r) => {
    const copy = [...r];
    while (copy.length < colCount) copy.push('');
    return copy;
  });

  const out: string[] = [];
  // Header = first row
  out.push('| ' + normalized[0].map((c) => c.replace(/\|/g, '\\|')).join(' | ') + ' |');
  out.push('| ' + new Array(colCount).fill('---').join(' | ') + ' |');
  for (let i = 1; i < normalized.length; i++) {
    out.push('| ' + normalized[i].map((c) => c.replace(/\|/g, '\\|')).join(' | ') + ' |');
  }
  return out;
}

// ---------- main rendering pipeline ----------

function linesToMarkdown(lines: Line[]): string {
  if (lines.length === 0) return '';

  const bodyHeight = computeBodyHeight(lines);
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 1) Code block: ≥2 consecutive monospace lines
    if (line.isMonoLine) {
      // Determine if block (≥2 lines) or inline-only (single short line).
      let j = i;
      const block: Line[] = [];
      while (j < lines.length && lines[j].isMonoLine) {
        block.push(lines[j]);
        j++;
      }

      if (block.length >= 2 || (block.length === 1 && block[0].text.trim().length > 40)) {
        // Compute base indent (min leading spaces across non-empty rows) and strip it
        const codeRows = block.map((l) => l.text.replace(/\s+$/, ''));
        const minIndent = codeRows
          .filter((r) => r.trim() !== '')
          .reduce((min, r) => {
            const m = r.match(/^( *)/);
            const n = m ? m[1].length : 0;
            return Math.min(min, n);
          }, Number.POSITIVE_INFINITY);
        const stripped = codeRows.map((r) => (minIndent > 0 && r.length >= minIndent ? r.slice(minIndent) : r));

        // Detect language hint from first row (very loose heuristic)
        const first = stripped[0]?.trim() ?? '';
        let lang = '';
        if (/^(import |from |def |class |print\(|if __name__)/.test(first)) lang = 'python';
        else if (/^(const |let |var |function |export |import )/.test(first)) lang = 'js';
        else if (/^(public |private |class .* \{|interface |package )/.test(first)) lang = 'java';
        else if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)/i.test(first)) lang = 'sql';
        else if (/^(\$ |# )/.test(first)) lang = 'bash';

        out.push('```' + lang);
        for (const row of stripped) out.push(row);
        out.push('```');
        out.push('');
        i = j;
        continue;
      }
      // else fall through and treat as a normal paragraph using inline code
    }

    // 2) Horizontal rule
    if (isHorizontalRule(line.text)) {
      out.push('');
      out.push('---');
      out.push('');
      i++;
      continue;
    }

    // 3) Table: try to gather contiguous lines that share ≥2 gap-separated cells
    if (splitCellsByGap(line).length >= 2) {
      let j = i;
      const tableRows: Line[] = [];
      while (
        j < lines.length &&
        !lines[j].isMonoLine &&
        splitCellsByGap(lines[j]).length >= 2 &&
        !isHorizontalRule(lines[j].text)
      ) {
        tableRows.push(lines[j]);
        j++;
      }
      if (tableRows.length >= 2 && detectColumnsFromGroup(tableRows)) {
        out.push(...renderTable(tableRows));
        out.push('');
        i = j;
        continue;
      }
    }

    // 4) Heading
    const depth = headingDepth(line.height, bodyHeight);
    if (depth > 0) {
      const inline = renderInlineSegments(line.segments).trim();
      if (inline.length > 0) {
        out.push('#'.repeat(depth) + ' ' + inline.replace(/^[#*_`]+/, '').trim());
        out.push('');
      }
      i++;
      continue;
    }

    // 5) List item
    const listInfo = detectListItem(line.text);
    if (listInfo.kind) {
      // Approximate indent level from leading whitespace in original text
      const leading = line.text.match(/^(\s*)/)?.[1] ?? '';
      const indent = '  '.repeat(Math.min(3, Math.floor(leading.length / 2)));
      // Re-render only the inline part (after the bullet/number)
      // Use the segments approach: rebuild with leading marker stripped from text representation
      const inline = renderInlineSegments(line.segments)
        .replace(/^\s*[\u2022\u25E6\u25AA\u25CF\u25CB\u2043\u2219\-*+]\s+/, '')
        .replace(/^\s*\d{1,3}[.)]\s+/, '');
      const marker = listInfo.kind === 'ul' ? '-' : `${listInfo.ordinal ?? '1'}.`;
      out.push(`${indent}${marker} ${inline.trim()}`);
      i++;
      continue;
    }

    // 6) Plain paragraph: merge with following non-empty body lines until we hit a blank/structural break
    let j = i;
    const paragraphSegments: LineSegment[][] = [];
    while (
      j < lines.length &&
      !lines[j].isMonoLine &&
      !isHorizontalRule(lines[j].text) &&
      headingDepth(lines[j].height, bodyHeight) === 0 &&
      detectListItem(lines[j].text).kind === null &&
      splitCellsByGap(lines[j]).length < 2
    ) {
      // Detect paragraph break by large vertical gap between consecutive lines
      if (j > i) {
        const prev = lines[j - 1];
        const curr = lines[j];
        if (prev.pageIndex === curr.pageIndex) {
          const gap = prev.y - curr.y; // PDF y descends downward
          if (gap > prev.height * 1.8) break;
        }
      }
      paragraphSegments.push(lines[j].segments);
      j++;
    }

    if (paragraphSegments.length > 0) {
      const paragraphText = paragraphSegments
        .map((segs) => renderInlineSegments(segs).trim())
        .filter((s) => s.length > 0)
        .join(' ');
      if (paragraphText.length > 0) {
        out.push(paragraphText);
        out.push('');
      }
      i = j;
      continue;
    }

    i++;
  }

  // Collapse triple+ blank lines
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimStart() + '\n';
}

// ---------- conversion driver ----------

async function convertPdfFile(inputFile: string, outputFile: string): Promise<void> {
  const buffer = await fs.readFile(inputFile);
  const { lines } = await extractLinesFromPdf(buffer);
  const md = linesToMarkdown(lines);
  await fs.ensureDir(path.dirname(outputFile));
  await fs.writeFile(outputFile, md, 'utf-8');
}

async function findPdfFiles(dir: string, recursive: boolean): Promise<string[]> {
  if (!(await fs.pathExists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) files.push(...(await findPdfFiles(abs, true)));
    else if (entry.isFile() && /\.pdf$/i.test(entry.name)) files.push(abs);
  }
  return files;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('pdf-to-md')
    .description('Convert PDF files to Markdown preserving code blocks, tables, lists and horizontal rules')
    .option('-i, --input <path>', `Input directory or file (default: ${DEFAULT_INPUT_DIR})`, DEFAULT_INPUT_DIR)
    .option('-o, --output <path>', `Output directory (default: ${DEFAULT_OUTPUT_DIR})`, DEFAULT_OUTPUT_DIR)
    .option('-f, --file', 'Convert a single file instead of a directory')
    .option('--no-recursive', 'Do not process subfolders')
    .parse(process.argv);

  const options = program.opts<CliOptions>();

  console.log(chalk.bold.cyan('\n=== PDF to Markdown Converter ===\n'));

  const inputPath = path.resolve(options.input);
  const outputPath = path.resolve(options.output);

  if (!(await fs.pathExists(inputPath))) {
    console.error(chalk.red(`Error: input not found: ${inputPath}`));
    process.exit(1);
  }

  let pdfs: string[] = [];
  if (options.file) {
    if (!/\.pdf$/i.test(inputPath)) {
      console.error(chalk.red(`Error: file must be a .pdf: ${inputPath}`));
      process.exit(1);
    }
    pdfs = [inputPath];
  } else {
    pdfs = await findPdfFiles(inputPath, options.recursive);
  }

  if (pdfs.length === 0) {
    console.log(chalk.yellow(`No PDF files found in ${inputPath}`));
    return;
  }

  console.log(chalk.cyan(`Found ${pdfs.length} PDF file(s)`));

  let ok = 0;
  let failed = 0;

  for (const pdfFile of pdfs) {
    const baseInputDir = options.file ? path.dirname(inputPath) : inputPath;
    const relative = path.relative(baseInputDir, pdfFile);
    const outFile = path.join(outputPath, relative.replace(/\.pdf$/i, '.md'));
    try {
      console.log(chalk.blue(`Converting: ${relative}`));
      await convertPdfFile(pdfFile, outFile);
      ok++;
      console.log(chalk.green(`  ✓ ${path.relative(process.cwd(), outFile)}`));
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`  ✗ ${relative}: ${message}`));
    }
  }

  console.log(chalk.bold.cyan('\nSummary'));
  console.log(chalk.green(`  Success: ${ok}`));
  if (failed > 0) {
    console.log(chalk.red(`  Failed:  ${failed}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(chalk.red('\nFatal error: ' + msg));
  process.exit(1);
});
