export interface PdfTextRun {text:string;level:number}
type FontEngine={layout:(text:string,requested?:string[],script?:string,language?:string,direction?:string)=>unknown};
type PdfDocumentWithFont=PDFKit.PDFDocument & {_font:{font:FontEngine}};
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import bidi_js from "bidi-js";
const bidi = (bidi_js)();
const features: NonNullable<PDFKit.Mixins.TextOptions['features']> = ["kern", "liga", "calt"];
const cleanPdfText = (text: unknown) => String(text ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
function pdfTextRuns(value: unknown, rtl: boolean) : PdfTextRun[] {
    const text = cleanPdfText(value).replace(new RegExp("\\p{Nd}+(?:[ \\t]*[.,:/\u066C\u066B-][ \\t]*\\p{Nd}+)+", "gu"), number => "\u2066" + number + "\u2069");
    const embedding = bidi.getEmbeddingLevels(text, rtl ? "rtl" : "ltr"), mirrors = bidi.getMirroredCharactersMap(text, embedding);
    const runs: PdfTextRun[] = [];
    for (let i = 0; i < text.length; i++) {
        const level = embedding.levels[i], char = mirrors.get(i) || text[i];
        if (runs.at(-1)?.level === level)
            runs[runs.length - 1].text += char;
        else
            runs.push({ text: char, level });
    }
    const max = Math.max(0, ...runs.map(run => run.level)), odd = runs.filter(run => run.level % 2).map(run => run.level), min = odd.length ? Math.min(...odd) : max + 1;
    for (let level = max; level >= min; level--)
        for (let i = 0; i < runs.length;) {
            if (runs[i].level < level) {
                i++;
                continue;
            }
            let end = i + 1;
            while (end < runs.length && runs[end].level >= level)
                end++;
            runs.splice(i, end - i, ...runs.slice(i, end).reverse());
            i = end;
        }
    return runs.map(run => ({ ...run, text: run.text.replace(/[\u2066\u2069]/g, "") })).filter(run => run.text);
}
function directionalPdfFont(doc: PDFKit.PDFDocument) {
    const engine = (doc as PdfDocumentWithFont)._font.font, layout = engine.layout.bind(engine);
    let direction = "ltr";
    engine.layout = (text, requested, script, language) => layout(text, requested, script, language, direction);
    const directed = <T,>(run: PdfTextRun, operation: () => T) => {
        const previous = direction;
        direction = run.level % 2 ? "rtl" : "ltr";
        try {
            return operation();
        }
        finally {
            direction = previous;
        }
    };
    return { measure(run: PdfTextRun, size: number) { return directed(run, () => doc.fontSize(size).widthOfString(run.text, { features })); }, draw(run: PdfTextRun, x: number, y: number) { return directed(run, () => doc.text(run.text, x, y, { lineBreak: false, features })); } };
}
export { cleanPdfText, directionalPdfFont, pdfTextRuns };
