# Repository Guidelines

## Project Structure & Module Organization
personal-knowledge-mcp is a TypeScript MCP server that indexes local documents. Runtime code sits in `src/`: `index.ts` bootstraps CLI + server, `server.ts` wires MCP tools, `storage/` wraps SQLite, `crawlers/` finds files, and `utils/` handles parsing. Builds land in `dist/`, while `data/knowledge.db` holds the FTS5 index (never edit manually). `config.json` configures watch paths, and `test-docs/` plus `test-pptx.md` provide sample fixtures.

## Build, Test, and Development Commands
- `npm run dev` – watch-mode TypeScript build; keep it running while coding.
- `npm run build` – clean `tsc` compile to `dist/`; required before shipping to Cherry Studio.
- `npm start` – start the stdio MCP server from `dist/index.js`.
- `npm run index` – run the crawler (`--index`) to rebuild the DB and show stats.
- `npm run sync` – temporary hook for future Feishu/WeCom sync flows.

## Coding Style & Naming Conventions
Use strict TypeScript (ES2022, Node16 modules, `rootDir: src`). Indent with 2 spaces, stick to `camelCase` for functions/variables and `PascalCase` for exported classes (`KnowledgeDatabase`, `LocalCrawler`). Prefer `async/await`, guard config reads, and keep side effects in entry points rather than scattered utilities. Comment only when intent is unclear; rely on types for documentation.

## Testing Guidelines
No automated tests yet, so depend on scripted manual checks. After changes, run `npm run build`, then `npm run index` against known directories in `config.json` to verify crawler and storage logic. Start the server (`npm start`) and exercise MCP tools via Cherry Studio or `mcp.txt`, inspecting responses and `mcp-server.log`. When adding parsers or filters, drop minimal repro files into `test-docs/` and describe the steps in your PR so reviewers can replay them.

## Commit & Pull Request Guidelines
Write imperative commit messages such as `feat: add PDF metadata parsing` or `fix: guard config load errors`. PR descriptions should cover context, solution, and manual verification (`npm run index` output, Cherry Studio screenshots, DB diffs if relevant). Cross-link issues, call out schema or config changes, and mention any migration needed for `data/knowledge.db`.

## Security & Configuration Tips
Treat `config.json` and `data/knowledge.db` as local secrets—never commit personal paths or content. Validate watch paths before crawling to avoid indexing sensitive directories, and redact document titles when sharing logs. Load any future credentials (Feishu, WeCom) from environment variables and document expected names instead of hardcoding tokens.
