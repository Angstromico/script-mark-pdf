# Markdown to Document Converter

A TypeScript CLI application that converts markdown files to PDF and Word documents with support for batch processing, subfolder preservation, and individual file conversion.

## Features

### Markdown to PDF
- **Batch Conversion**: Convert all markdown files in a directory to PDF
- **Subfolder Preservation**: Maintains the original folder structure in the output directory
- **Individual File Conversion**: Convert single markdown files to PDF
- **Customizable Paths**: Specify custom input and output directories
- **Recursive Processing**: Option to process subfolders (enabled by default)
- **Beautiful PDF Output**: Clean, styled PDFs with proper formatting for code blocks, tables, and more
- **Colored Console Output**: Easy-to-read progress updates

### Markdown to Word
- **Batch Conversion**: Convert all markdown files in a directory to Word (.docx)
- **Subfolder Preservation**: Maintains the original folder structure in the output directory
- **Individual File Conversion**: Convert single markdown files to Word
- **Customizable Paths**: Specify custom input and output directories
- **Recursive Processing**: Option to process subfolders (enabled by default)
- **Clean Word Documents**: Well-formatted .docx files with proper text formatting
- **Colored Console Output**: Easy-to-read progress updates

### Markdown to All (PDF + Word)
- **Unified Conversion**: Converts markdown files to both PDF and Word in one go
- **Formatted Output**: Uses high-quality styling for both PDF and Word documents
- **Default Folders**: Reads from `md-files`, outputs to `docs-files`

...

### Dual Converter (PDF + Word)
- `npm run md-to-docs`: Run the compiled dual converter (Simplified)
- `npm run dev:md-to-docs`: Run the dual converter directly (Simplified)

### Unified Converter (PDF + Word with High-Quality Formatting)
- `npm run md-to-all`: Run the compiled high-quality dual converter
- `npm run dev:md-to-all`: Run the high-quality dual converter directly with TypeScript (ts-node)


### Clean Folders
- `npm run clean`: Clean all default folders
- `npm run dev:clean`: Run the clean command directly with TypeScript (ts-node)

## License

ISC

## Author

Manuel Morales
