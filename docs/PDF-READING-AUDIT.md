# PDF reading and primary-site audit

Audit date: 2026-10-17. This document records direct inspection of the supplied PDFs and primary-site pages. It is a source and adaptation record, not a current certification, clinical instruction, price list or orderable-variant database.

## Delivered web documents

| Document | Original pages | Web pages | Original bytes | Web bytes | Web download |
|---|---:|---:|---:|---:|---|
| Ideal Makoo complete catalogue and mould chart | 1 | 26 | 47,886,307 | 8,051,624 | `/media/documents/ideal-makoo-complete-catalogue-web.pdf` |
| Ideal Makoo illustrated mould guide | 14 | 14 | 55,859,721 | 4,904,373 | `/media/documents/ideal-makoo-mould-guide-web.pdf` |

The original uploads were read directly from the uploaded local paths and remain unchanged. Neither large original was copied into `public`. The web files are explicitly marked as derived in their metadata and in every reader/download context. Source and web SHA256 digests are available in `SOURCES.json`, `reference-documents.ts`, and the reader’s provenance disclosure.

The source poster contains a cover and 25 printed panels, laid out over one large page. Each logical panel is preserved in its own web PDF page and JPEG. The 14-page recovered guide retains its original page order. White-gutter crop boundaries were visually corrected per row so neighbouring panel strips do not bleed into the web edition. JPEG quality 93 with full colour sampling keeps the printed material readable.

## Identity and data limitations

- Both files visibly carry Ideal Makoo branding. The recovered guide’s filename contains `enigmalife`, but the visible cover and content do not establish a separate Enigma product. It is labelled by visible source identity, with the original filename preserved.
- Several mould rows and three anterior/posterior matching tables are empty in the supplied artwork. Those cells remain empty; hidden duplicated PDF text was not used to create missing values.
- The five legible posterior rows and 32 Small/Medium/Large/Lower anterior rows are transcribed from the recovered guide where individual glyphs are readable. Missing/unclear codes and measurements remain empty; one ambiguous Large Soft width is deliberately omitted. Column labels describe diagram positions; the source page does not explicitly print measurement units.
- The catalogue’s `B.STAR nano plan_ nano glas` profile is retained as an archival section. A nearby `nano base` heading repeats Nano Glass wording in its body/material box. These discrepancies remain disclosed and do not create a new current product.
- Source material is archived and undated. Metadata creation/modification dates have not been substituted for verified publication dates. Logos or package markings are not presented as current certificate validation.

## Catalogue page inventory

| Web page | Original panel | Section | Linked live product |
|---:|---:|---|---|
| 1 | Cover | Cover and document identity | — |
| 2 | 1 | Tooth structure and appearance | — |
| 3 | 2 | Square, triangular and oval forms | — |
| 4 | 3 | Square upper anterior moulds | — |
| 5 | 4 | Triangular upper anterior moulds | — |
| 6 | 5 | Oval upper anterior moulds | — |
| 7 | 6 | Lower anterior moulds | — |
| 8 | 7 | N and T posterior groups | — |
| 9 | 8 | Square matching table · empty cells | — |
| 10 | 9 | Triangular matching table · empty cells | — |
| 11 | 10 | Oval matching table · empty cells | — |
| 12 | 11 | Small and medium anterior dimensions | — |
| 13 | 12 | Large and lower anterior dimensions | — |
| 14 | 13 | Illustrated posterior dimensions | — |
| 15 | 14 | President catalogue profile | president |
| 16 | 15 | B.STAR nanocomposite catalogue profile | bstar-nano-composite |
| 17 | 16 | B.STAR nano plan / nano glas catalogue profile | — |
| 18 | 17 | B.STAR nano base catalogue profile | bstar-nano-base |
| 19 | 18 | Apple catalogue profile | apple |
| 20 | 19 | Glamour catalogue profile | glamour |
| 21 | 20 | Yaghoot catalogue profile | yaghoot |
| 22 | 21 | Super Berelian catalogue profile | super-berelian |
| 23 | 22 | Berelian catalogue profile | berelian |
| 24 | 23 | Marjan / Marjan New catalogue profile | marjan-new |
| 25 | 24 | Super Newclar catalogue profile | super-newclar |
| 26 | 25 | Newclar catalogue profile | newclar |

## Recovered mould guide page inventory

| Source and web page | Section |
|---:|---|
| 1 | Cover and document identity |
| 2 | Tooth structure and appearance |
| 3 | Square, triangular and oval forms |
| 4 | Square upper anterior moulds |
| 5 | Triangular upper anterior moulds |
| 6 | Oval upper anterior moulds |
| 7 | Lower anterior moulds |
| 8 | N and T posterior groups |
| 9 | Square matching table · empty cells |
| 10 | Triangular matching table · empty cells |
| 11 | Oval matching table · empty cells |
| 12 | Small and medium anterior dimensions |
| 13 | Large and lower anterior dimensions |
| 14 | Illustrated posterior dimensions |

## Primary website coverage

The audit fetched 43 successful public pages: 17 products, 13 research entries, 10 company pages, and the home/product/research indexes. A scan of internal links found no additional page IDs beyond this inventory. All 42 `<img>` URLs in page markup are already covered by the existing 67 official source assets (the larger inventory also contains related linked/cover/background assets). No linked PDF, Office or ZIP document was found on these pages.

`robots.txt` and `sitemap.xml` returned 404. The official about video URL (`https://idealmakoo.com/movies/film1.mp4`) returned 403 and is not marked as playable. The blog index is an archive of research entries; dated company news or a live event schedule was not fabricated.

All original visible page text is retained in `src/data/official-source-pages.ts`: 43 records and 74,767 captured characters. `contentText` contains 50,432 characters after removing identifiable repeated navigation and footer text; `text` preserves the complete capture. The corresponding JSON audit is `docs/OFFICIAL-SITE-KNOWLEDGE.json`.

The initial 17/13/10 canonical inventory remains unchanged. Fourteen product entries gained verified multilingual feature descriptions. Nine company pages gained fuller five-language explanations. Existing canonical source specs were preserved, and full original Persian prose is available beside the public summaries.

## UI integration and grounding contracts

- Resource readers: `resources/ideal-makoo-mould-poster` and `resources/ideal-makoo-mould-guide`, with a stable `?page=N` reader link and `#page=N` PDF link.
- All primary texts: `resources/official-site-archive`, with exact source anchors `#official-page-<number>` and `#official-page-home`.
- Product detail: a related catalogue profile for each of the 11 matched series, a general mould-guide link for canonical tooth products, and a complete original-source text disclosure. Local editor-authored products are not falsely assigned an official archive entry.
- Research detail: original Persian text disclosure in addition to the translated summary. Research index also links the uploaded catalogues as product references; they are not counted as extra research articles.
- Company pages: fuller localized copy and original-source disclosures. About/manufacturing also expose the document collection.
- The 40 page images, reader titles, section summaries, table labels, navigation, notices and provenance labels cover Persian, English, Turkish, Arabic and Russian. Original Persian source notes are labelled by language.
- `referenceDocuments` exports source/web provenance, 40 normalized sections, localized summaries, original page/panel indexes and source images. `officialSourcePages` exports all 43 captured source records. These are the factual inputs available to the server grounding layer.

## Validation

The PDF artifact marker ran successfully before creating the two derived PDFs. Both PDFs were rendered after authoring; representative cover, appearance, table and product pages were inspected at readable size, and all 40 logical source pages were reviewed through contact sheets. A per-row poster-gutter correction was made and rechecked. Every final web PDF is below 10 MB; every page JPEG is below 1 MB.

`tests/reference-documents.test.mjs` adds nine substantive checks: original provenance/page coverage, genuine PDF headers/size/SHA256, all 40 JPEG assets and section page anchors, five-language coverage, valid catalogue-product links without an invented Nano Glass product, recovered-file branding and blank-matrix preservation, bounded PDF page URL construction, exact coverage of all 43 canonical source pages, and retention of unknown cells among the 37 guide dimension rows. All nine pass. Static TypeScript checking passes; no browser/server QA, build, deployment or git operation was performed for this subtask.
