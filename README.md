# DocuVision

A document-processing workspace for organizing scanned files, running OCR and extraction stages, and reviewing structured results.

## Overview

DocuVision provides a dashboard for document intake and processing. Documents move through visible pipeline states such as discovery, queuing, OCR, extraction, completion, and failure, with dedicated views for document details, review, and pipeline settings.

## Highlights

- Dashboard for recent documents and processing status.
- Document detail view with page previews, extracted data, and combined OCR text.
- Review queue for human verification of processed documents.
- Configurable scanner directory and inference settings.
- Server-side scanner and page-image routes.
- Clear error handling for failed processing stages.

## Technology

- React 19 and TypeScript
- TanStack Start and Vite
- Tailwind CSS
- Supabase authentication and data services
- Zod, date-fns, and Lucide React

## Local development

```bash
bun install
bun run dev
```

Copy `.env.example` to `.env` and configure the required Supabase and server-side processing values. Keep local environment files and service credentials out of Git.

## Project structure

The application shell lives in `src/components/AppShell.tsx`. Document workflows are implemented in `src/routes/`, while scanning and server integrations are separated under `src/lib/`, `src/server.ts`, and the API routes. The original architecture notes are preserved in [`docs/design-notes.md`](docs/design-notes.md).

## Status

This repository is a portfolio project focused on document operations, OCR workflow design, review queues, and typed full-stack routing.

## License

No license has been declared yet. Add a license before accepting external contributions or distributing the project.

## Author

**Bilel JM** — [GitHub](https://github.com/bilel11111)
