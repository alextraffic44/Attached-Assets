---
name: SEO machine article split
description: generateArticleHtml now uses split responsibility — AI writes content fragment only, TypeScript builds the full page wrapper.
---

# SEO Article Split Architecture

## The Rule
`generateArticleHtml` in `server/seo-routes.ts` does NOT ask AI to generate a full HTML page. Instead:
- **AI writes**: article-header, hero-article-img, key-takeaways, toc, article-body, author-box, faq-section, related-articles — just the inner fragment, no page-level tags
- **TypeScript wraps**: `<!DOCTYPE>`, `<head>` with meta/schema, `<nav>` (via `buildNav`), breadcrumb, `article-layout` div with `.article-main` + sidebar `<aside>`, `<footer>` (via `buildFooter`), FAQ/TOC `<script>`

## Why
AI reliably generates article content but was inconsistently building nav, sidebar, and footer (wrong classes, missing ad slots, variable structure). Splitting ensures 100% consistent magazine layout across all generated articles.

## How to Apply
- Prompt says: "Write ONLY the inner article HTML fragment — NO <!DOCTYPE>, NO <html>, NO <head>, NO <nav>, NO <footer>, NO <body>"
- After AI returns, strip any accidental page-level tags with regex
- Sidebar is built by TypeScript using `cluster.keywords` for "В этом разделе" links and `allClusters` for "Ещё материалы" links
- Ad slots (`cfg.adUnitCode`) are injected at 2 sidebar positions; `cfg.adHeadCode` goes in `<head>`
- IMG_PLACEHOLDER_1 used in `<img class="hero-article-img">`, IMG_PLACEHOLDER_2/3 in article body
