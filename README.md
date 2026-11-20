# ERP workspace

This project contains the API, Classic interface and Modern interface. Company branding and optional modules are configured per deployment; the current database contains the Fortune 7 demonstration data.

## Start the existing installation

Keep the configured MySQL/MariaDB instance running. Preserve the existing server/.env, frontend .env.local files, database directories and uploads.

Open separate terminals from this project folder:

- API: cd server, then npm run dev (port 4000).
- Classic: cd client, then npm run dev (port 5173).
- Modern: cd client-modern, then npm run dev (port 5174).

If dependencies need reinstalling, run npm ci in each of those three folders first. Do not run database push, schema reset or seed commands as part of normal startup: the existing database already contains records.

## Configure and demonstrate

- Admin > Company & Modules controls branding and optional features. Roles control individual access.
- Profile > Client Demo presents the business workflow. Product Tour and Sales Flow are also available there.
- Tour boxes can be moved by dragging the heading and resized from any edge/corner.
- The assistant suggests questions for the current screen, shows source/filter details and provides workflow guides. Each question stands alone. Clarification choices resolve incomplete questions; conversation memory is disabled. It cannot change business records.

## Files to preserve

- server/src, server/prisma, server/assets and server/uploads: API, schema, bundled assets and saved customer documents/photos.
- client and client-modern: independent frontend sources, public assets and build configuration.
- package.json and package-lock.json in each application: scripts and locked dependencies.
- local-runtime and .local-mysql: local database/runtime files. Never delete these as ordinary build clutter.
- products and logo.jpeg: supplied product images and company artwork.
- .local-run: current process metadata, required demo checkpoints, rollback pointers and the folder-sync helpers. It is not the application source.

## Setup and maintenance references

- docs/generic-erp-setup.md: configure a separate customer deployment. Each customer requires a separate database, uploads, secrets and backups.
- CONTRACT.md and prompt.md: backend conventions and the original specification.
- client/README-SHELL.md: shared frontend conventions; also applies to the corresponding Modern components.
- server/src/assistant/README.md: assistant behaviour, limitations, tests and logging.

## Checks

From server: npm run typecheck, npm run assistant:test and npm run assistant:test:upgrade. Live assistant tests require the isolated local demo database; HTTP tests require its API. Keep regression fixtures beside their tests.

From client and client-modern: npm run build.

Old editing scripts, screenshots, duplicate notes and PDF render intermediates have been archived outside the project. The requested quotation and management PDFs are retained under the cleanup archive's deliverables folder. See .local-run/cleanup-archive.json for the archive location. No functional application source or database files were removed.
