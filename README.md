# Markdown to Document Converter

A TypeScript CLI application that converts markdown files to professional PDF and Word documents, featuring full support for **Mermaid diagrams**, batch processing, and high-quality formatting.

## Features

### 📊 Mermaid Diagram Support
- **PDF Rendering**: Mermaid diagrams are rendered directly during PDF generation using `md-to-pdf`.
- **Word Rendering**: Diagrams are automatically rendered into high-quality images and embedded into the `.docx` files.
- **Seamless Integration**: Simply use standard ` ```mermaid ` blocks in your markdown files.

### 📄 Markdown to PDF
- **Batch Conversion**: Convert all markdown files in a directory to PDF.
- **Subfolder Preservation**: Maintains the original folder structure in the output directory.
- **Beautiful Output**: Clean, styled PDFs with syntax highlighting, tables, and full Mermaid support.

### 📝 Markdown to Word
- **Professional Formatting**: High-quality `.docx` generation with proper headings, lists, tables, and styling.
- **Embedded Diagrams**: Mermaid diagrams are automatically converted to images and included in the document.
- **Folder structure**: Preserves your directory tree in the output folder.

### 🔄 Dual Conversion (PDF + Word)
- **One-Step Processing**: Generate both formats simultaneously using `md-to-docs` or `md-to-all`.
- **Consistent Quality**: Both formats share the same high-quality rendering engine for diagrams and layout.

...

### Dual Converter (PDF + Word)
- `npm run md-to-docs`: Converts all files in `./md-files` to both PDF and Word in `./docs-files`.
- `npm run dev:md-to-docs`: Run the dual converter directly using `ts-node`.

### High-Quality Unified Converter
- `npm run md-to-all`: Alternative command for dual conversion with specialized formatting.
- `npm run dev:md-to-all`: Run the high-quality unified converter with TypeScript.


### Clean Folders
- `npm run clean`: Clean all default folders
- `npm run dev:clean`: Run the clean command directly with TypeScript (ts-node)

## License

GNU General Public License v3.0

## Author

Manuel Morales
