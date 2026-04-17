# Markdown to PDF Converter

A TypeScript CLI application that converts markdown files to PDF with support for batch processing, subfolder preservation, and individual file conversion.

## Features

- **Batch Conversion**: Convert all markdown files in a directory to PDF
- **Subfolder Preservation**: Maintains the original folder structure in the output directory
- **Individual File Conversion**: Convert single markdown files to PDF
- **Customizable Paths**: Specify custom input and output directories
- **Recursive Processing**: Option to process subfolders (enabled by default)
- **Beautiful PDF Output**: Clean, styled PDFs with proper formatting for code blocks, tables, and more
- **Colored Console Output**: Easy-to-read progress updates

## Installation

1. Clone or download this repository
2. Install dependencies:

```bash
npm install
```

3. Build the TypeScript project:

```bash
npm run build
```

## Usage

### Basic Usage (Default Settings)

Convert all markdown files from the default `./markdown` directory to PDF in the `./pdf` directory:

```bash
npm start
```

Or using the compiled JavaScript directly:

```bash
node dist/index.js
```

### Custom Input/Output Directories

Specify custom input and output directories:

```bash
npm start -- -i /path/to/markdown -o /path/to/output
```

Or:

```bash
node dist/index.js -i /path/to/markdown -o /path/to/output
```

### Convert a Single File

Convert a single markdown file to PDF:

```bash
npm start -- -f -i /path/to/file.md -o /path/to/output
```

Or:

```bash
node dist/index.js -f -i /path/to/file.md -o /path/to/output
```

### Disable Recursive Processing

Convert only the top-level markdown files without processing subfolders:

```bash
npm start -- --no-recursive -i /path/to/markdown -o /path/to/output
```

### Development Mode

Run the script directly with TypeScript (requires ts-node):

```bash
npm run dev -- -i ./markdown -o ./pdf
```

## Command Line Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--input <path>` | `-i` | Input directory or file path | `./markdown` |
| `--output <path>` | `-o` | Output directory path | `./pdf` |
| `--file` | `-f` | Convert a single file instead of a directory | `false` |
| `--no-recursive` | | Do not process subfolders | `false` (recursive enabled) |
| `--help` | `-h` | Display help information | |
| `--version` | `-V` | Display version number | |

## Examples

### Example 1: Convert all markdown files with defaults

```bash
npm start
```

This will:
- Read all `.md` and `.markdown` files from `./markdown`
- Process subfolders recursively
- Create PDFs in `./pdf` with the same folder structure

### Example 2: Convert a specific folder to a specific output

```bash
npm start -- -i ./docs -o ./output/pdfs
```

### Example 3: Convert a single file

```bash
npm start -- -f -i ./README.md -o ./output
```

This will create `./output/README.pdf`

### Example 4: Convert only top-level files (no subfolders)

```bash
npm start -- --no-recursive -i ./content -o ./output
```

## Project Structure

```
script-mark-pdf/
├── src/
│   └── index.ts          # Main TypeScript source code
├── dist/                 # Compiled JavaScript (created after build)
├── markdown/             # Default input directory for markdown files
├── pdf/                  # Default output directory for PDF files
├── package.json          # Project configuration and dependencies
├── tsconfig.json         # TypeScript configuration
└── README.md             # This file
```

## How It Works

1. **Markdown Parsing**: Uses the `marked` library to convert markdown to HTML
2. **PDF Generation**: Uses `puppeteer` (headless Chrome) to render HTML to PDF
3. **File Processing**: 
   - For directories: Recursively scans for `.md` and `.markdown` files
   - Preserves the relative folder structure in the output directory
   - For individual files: Converts the specified file directly
4. **Styling**: Applies clean, modern CSS styling to the PDF output

## Supported Markdown Features

- Headers (h1-h6)
- Paragraphs and line breaks
- Code blocks (with syntax highlighting background)
- Inline code
- Blockquotes
- Tables
- Links
- Images
- Lists (ordered and unordered)
- Horizontal rules

## Requirements

- Node.js (v16 or higher recommended)
- npm or yarn

## Dependencies

- `commander`: CLI argument parsing
- `marked`: Markdown to HTML conversion
- `puppeteer`: Headless Chrome for PDF generation
- `chalk`: Colored console output
- `fs-extra`: Enhanced file system operations

## Development Scripts

- `npm run build`: Compile TypeScript to JavaScript
- `npm start`: Run the compiled script
- `npm run dev`: Run the script directly with TypeScript (ts-node)

## License

ISC

## Author

Manuel Morales
