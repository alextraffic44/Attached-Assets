---
name: Cyrillic web fonts for generated content
description: Which Google Fonts to use (and avoid) when generated site text is Russian/Cyrillic
---

# Cyrillic-capable display fonts for generated sites

Generated "Интерактивный" (scroll-anim) sites render Russian text, so any font embedded
in generated output MUST include Cyrillic glyphs or the headings fall back to a system
font and look broken/inconsistent.

**Safe on Google Fonts (have Cyrillic):** Unbounded (bold display, modern/"cool"),
Manrope (clean body), Onest, Golos Text, Rubik, Montserrat, Inter.

**Do NOT use for Cyrillic — Latin-only (will not render Russian):** Space Grotesk, Syne,
most "designer" display faces. Verify Cyrillic subset before picking a font for RU content.

**Why:** user complained generated animation text needed cooler fonts; the obvious trendy
picks (Space Grotesk / Syne) silently drop Cyrillic. Chose Unbounded + Manrope for the
scroll-anim text layers (`buildScrollAnimHtml`), embedded via `@import` as the first rule
in the injected `<style>`, with `system-ui` fallback in the font stack.

**How to apply:** any time you embed/recommend a webfont for generated Russian-language
output, confirm the Cyrillic subset exists; default to Unbounded (headings) + Manrope (body).
