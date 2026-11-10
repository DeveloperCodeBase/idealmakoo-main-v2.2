/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */


import type { SharedQuote, FrontRequest } from '../types/frontend';
import type { Actor } from './types';
import PDFDocument from "pdfkit";
import { QUOTE_PDF_MAX_BYTES, getOrCreateQuoteArtifact } from "./quote-artifacts";
import { HttpError, assert } from "./types";
import { join } from "node:path";
import { directionalPdfFont, pdfTextRuns, cleanPdfText } from "./pdf-text-layout";
import { transaction, audit } from "./db";
import { getRequestRow, canAccessRequestQuote } from "./requests";
import { rateLimit } from "./http";
const labels={
  fa:['پیش‌فاکتور','شماره','تاریخ صدور','اعتبار تا','مشتری','شرح محصول','مقدار','قیمت واحد','خالص','جمع کل','شرایط','این سند پیشنهاد تجاری است. ثبت سفارش نهایی نیازمند تأیید واحد فروش است.'],
  en:['Quotation','Number','Issued','Valid until','Customer','Product description','Quantity','Unit price','Net','Grand total','Terms','This document is a commercial proposal. Final orders require confirmation by the sales team.'],
  tr:['Fiyat teklifi','Numara','Düzenlenme','Geçerlilik','Müşteri','Ürün açıklaması','Miktar','Birim fiyat','Net','Genel toplam','Koşullar','Bu belge ticari bir tekliftir. Kesin siparişler satış ekibinin onayını gerektirir.'],
  ar:['عرض أسعار','الرقم','تاريخ الإصدار','صالح حتى','العميل','وصف المنتج','الكمية','سعر الوحدة','الصافي','الإجمالي','الشروط','هذه الوثيقة عرض تجاري. تتطلب الطلبات النهائية تأكيد فريق المبيعات.'],
  ru:['Коммерческое предложение','Номер','Выдано','Действует до','Клиент','Описание товара','Количество','Цена за единицу','Итого','Общая сумма','Условия','Документ является коммерческим предложением. Окончательный заказ требует подтверждения отдела продаж.'],
};
async function renderQuotePdf(quote:SharedQuote,request:Pick<FrontRequest,'name'|'organization'|'locale'>):Promise<Buffer>{
    const locale = quote.locale || request.locale || "fa";
    const copy=labels[locale];
    const rtl=locale==='fa'||locale==='ar';
    const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true,autoFirstPage:true,info:{Title:quote.number,Author:'Ideal Makoo',Subject:'Approved quotation '+quote.snapshotHash,CreationDate:new Date(quote.issuedAt),ModDate:new Date(quote.issuedAt)}});
    const output:Buffer[]=[];
    let outputBytes = 0;
    const completed = new Promise<Buffer>((resolve, reject) => {
        doc.on("data", chunk => {
            outputBytes += chunk.length;
            if (outputBytes > QUOTE_PDF_MAX_BYTES) {
                doc.destroy(new HttpError(413, "QUOTE_PDF_SIZE", "The quotation PDF exceeds the 4 MiB artifact limit."));
                return;
            }
            output.push(chunk);
        });
        doc.on('end',()=>resolve(Buffer.concat(output)));
        doc.on('error',reject);
    });
    doc.registerFont('body',join(process.cwd(),'public/fonts/DejaVuSans.ttf'));
    doc.font('body');
    const font = (directionalPdfFont)(doc);
    const left=42;
    const width=doc.page.width-84;
    let y=42;
    const measure = (text:string, size:number) => (pdfTextRuns)(text, rtl).reduce((sum, run) => sum + font.measure(run, size), 0);
    function lines(text:unknown,maxWidth:number,size:number){
        const all:string[]=[];
        for (const paragraph2 of (cleanPdfText)(text).split(/\r?\n/)) {
            let line='';
            for (const word of paragraph2.split(/\s+/)) {
                const proposed=line?line+' '+word:word;
                if (measure(proposed,size) <= maxWidth) {
                    line = proposed;
                    continue;
                }
                if (line)
                    all.push(line);
                line = "";
                for (const char of word) {
                    if (measure(line+char,size) > maxWidth && line) {
                        all.push(line);
                        line = "";
                    }
                    line += char;
                }
            }
            all.push(line);
        }
        return all;
    }
    function drawLine(text:string,x:number,top:number,maxWidth:number,size=10,color='#18314a',align:'left'|'right'=rtl?'right':'left'){ const runs = (pdfTextRuns)(text, rtl); const widths = runs.map(run => font.measure(run, size)); let cursor=x+(align==='right'?Math.max(0,maxWidth-widths.reduce((a,b)=>a+b,0)):0); doc.fontSize(size).fillColor(color); runs.forEach((run, index) => { font.draw(run, cursor, top); cursor += widths[index]; }); }
    function pageBreak(height:number){if(y+height>doc.page.height-78){doc.addPage();y=44;drawLine('IDEAL MAKOO  /  '+quote.number,left,y,width,10,'#597284','left');y+=30;}}
    function paragraph(text:unknown,size=10,color='#18314a',space=8){for(const line of lines(text,width,size)){pageBreak(size*1.55);drawLine(line,left,y,width,size,color);y+=size*1.55;}y+=space;}
    doc.roundedRect(left,y,width,70,8).fill('#0b263b');
    drawLine('IDEAL MAKOO',left+16,y+12,width-32,14,'#ffffff','left');
    drawLine(copy[0],left+16,y+38,width-32,18,'#7fe6dc');
    y += 90;
    paragraph(quote.title,16);
    paragraph(`${copy[1]}: ${quote.number}`,10);
    paragraph(`${copy[2]}: ${quote.issuedAt.slice(0,10)}${quote.validUntil?'     '+copy[3]+': '+quote.validUntil.slice(0,10):''}`,10);
    const customer = quote.customerSnapshot || request;
    paragraph(`${copy[4]}: ${customer.name}${customer.organization ? " / " + customer.organization : ""}`, 11);
    if (quote.customerSnapshot) {
        const party = quote.customerSnapshot;
        if (party.address)
            paragraph(party.address, 10);
        const contact = [party.email, party.phone, party.country].filter(Boolean).join("  |  ");
        if (contact)
            paragraph(contact, 9);
    }
    if (quote.sellerSnapshot) {
        const seller = quote.sellerSnapshot;
        const sellerLabel = { fa: "\u0641\u0631\u0648\u0634\u0646\u062F\u0647", en: "Seller", tr: "Sat\u0131c\u0131", ar: "\u0627\u0644\u0628\u0627\u0626\u0639", ru: "\u041F\u0440\u043E\u0434\u0430\u0432\u0435\u0446" }[locale];
        paragraph(`${sellerLabel}: ${seller.name}`, 11);
        if (seller.address)
            paragraph(seller.address, 10);
        const contact = [seller.email, seller.phone].filter(Boolean).join("  |  ");
        if (contact)
            paragraph(contact, 9);
    }
    y += 4;
    const columns=[{w:244,label:copy[5]},{w:64,label:copy[6]},{w:96,label:copy[7]},{w:width-404,label:copy[8]}];
    function tableHeader(){pageBreak(32);doc.rect(left,y,width,28).fill('#e7f3f4');let x=left;for(const column of columns){drawLine(column.label,x+7,y+7,column.w-14,9);x+=column.w;}y+=32;}
    tableHeader();
    for (const [lineIndex, line] of (quote.lines || []).entries()) {
        const cells=[`${line.titleSnapshot}\n${line.unit}${line.discountPercentDecimal!=='0'?'  (-'+line.discountPercentDecimal+'%)':''}`,line.quantityDecimal,line.unitPriceDecimal??'',line.netDecimal??''];
        const wrapped=cells.map((cell,index)=>lines(cell,columns[index].w-14,9));
        let offset=0;
        const count=Math.max(...wrapped.map(values=>values.length));
        const rowHeight = count * 14 + 15, keepWithTotal = lineIndex === (quote.lines?.length || 0) - 1 ? 90 : 0;
        if (rowHeight + keepWithTotal <= doc.page.height - 184 && y + rowHeight + keepWithTotal > doc.page.height - 78) {
            pageBreak(rowHeight + keepWithTotal);
            tableHeader();
        }
        while (offset < count) {
            if (y + 28 > doc.page.height - 78) {
                pageBreak(40);
                tableHeader();
            }
            const capacity=Math.max(1,Math.floor((doc.page.height-82-y)/14));
            const amount=Math.min(count-offset,capacity);
            const height=amount*14+12;
            let x=left;
            doc.rect(left,y,width,height).fill('#f7fafb');
            for (let i=0; i < columns.length; i++) {
                wrapped[i].slice(offset,offset+amount).forEach((text,j)=>drawLine(text,x+7,y+5+j*14,columns[i].w-14,9,'#18314a',i===0?(rtl?'right':'left'):'right'));
                x += columns[i].w;
            }
            y += height + 3;
            offset += amount;
        }
    }
    y += 12;
    pageBreak(54);
    doc.roundedRect(left,y,width,42,5).fill('#0b263b');
    drawLine(`${copy[9]}: ${quote.amount} ${quote.currency}`,left+12,y+11,width-24,14,'#ffffff');
    y += 62;
    if (quote.terms) {
        paragraph(copy[10],13);
        paragraph(quote.terms,10);
    }
    paragraph(copy[11],9,'#597284');
    const range=doc.bufferedPageRange();
    for (let page=0; page < range.count; page++) {
        doc.switchToPage(page);
        const top=doc.page.height-58;
        doc.moveTo(left,top).lineTo(left+width,top).strokeColor('#d5e2e8').stroke();
        drawLine(`Commercial snapshot SHA-256  ${quote.snapshotHash}`,left,top+8,width,6,'#597284','left');
        drawLine(`${page+1} / ${range.count}`,left,top+21,width,8,'#597284','right');
    }
    doc.end();
    return completed;
}
async function quotePdf(actor:Actor|null,requestId:string,quoteId:string,guest:string|null){ assert(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(quoteId),404,'NOT_FOUND','Quotation not found.'); const result = await (transaction)(async (client) => { const request = await (getRequestRow)(requestId, client, true); (assert)(await (canAccessRequestQuote)(actor, request, guest, client), 404, "NOT_FOUND", "Quotation not found."); await rateLimit('quote-pdf:'+(actor?.id||guest),30,60); const row = (await client.query("SELECT snapshot,record_id FROM quote_snapshots WHERE id=$1 AND request_id=$2", [quoteId, requestId])).rows[0]; assert(row,404,'NOT_FOUND','Quotation not found.'); (assert)(row.snapshot.id === quoteId && (!row.snapshot.requestId || row.snapshot.requestId === requestId) && (!row.snapshot.recordId || row.snapshot.recordId === row.record_id), 503, "QUOTE_ARTIFACT_INTEGRITY", "The stored quotation identity is inconsistent."); const value = await (getOrCreateQuoteArtifact)(client, { ...row.snapshot, requestId, recordId: row.record_id }, actor?.id || null); await (audit)(actor?.id || null, "quote.pdf.downloaded", "quote", quoteId, { requestId, fileSha256: value.artifact.sha256, fileByteCount: value.artifact.byte_count, origin: value.artifact.origin }, client); return { artifact: value.artifact, number: row.snapshot.number }; }); const { artifact } = result; return new Response(new Uint8Array(artifact.pdf_bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${result.number.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Length": String(artifact.byte_count), "X-Content-SHA256": artifact.sha256, "X-Quote-PDF-Origin": artifact.origin } }); }
export { quotePdf, renderQuotePdf };
