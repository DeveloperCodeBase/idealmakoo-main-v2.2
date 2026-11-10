#!/usr/bin/env python3
"""Create explicitly derived, readable web editions of the two supplied PDFs.
Original uploads are never edited/copied into public. Run the PDF artifact marker before execution.
Requires PyMuPDF and Pillow in the artifact runtime; not part of the web application build.
"""
from pathlib import Path
import hashlib, io, json
import fitz
from PIL import Image, ImageOps, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
UPLOAD=ROOT.parent/'upload'
OUT=ROOT/'public/media/documents'
PREVIEWS=OUT/'previews'
QA=Path('/tmp/idealmakoo-pdf-audit/derived')
for directory in (OUT,PREVIEWS,QA): directory.mkdir(parents=True,exist_ok=True)
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def encode(image):
    stream=io.BytesIO()
    image.convert('RGB').save(stream,'JPEG',quality=93,optimize=True,subsampling=0)
    return stream.getvalue()
def save_document(source_name,stem,poster=False):
    source=UPLOAD/source_name
    src=fitz.open(source)
    pdf=fitz.open()
    pages=[]
    if poster:
        pix=src[0].get_pixmap(matrix=fitz.Matrix(2,2),colorspace=fitz.csRGB,alpha=False)
        whole=Image.frombytes('RGB',(pix.width,pix.height),pix.samples)
        # Source artwork uses slightly different gutters on each row. These
        # visually checked boundaries lie in white gutters; equal 1/7 cuts
        # would include a sliver of the neighbouring panel. Coordinates are
        # in the original 8569 x 7102 raster rendered at 2 pixels per point.
        gutters=[
            [0,1210,2430,3649,4870,6090,7312,8569],
            [0,1210,2435,3658,4880,6106,7333,8569],
            [0,1210,2435,3659,4885,6115,7354,8569],
            [0,1205,2430,3653,4868,6085,7354,8569],
        ]
        assert whole.size==(8569,7102), 'Source raster changed; inspect crop boundaries again.'
        frames=[]
        for index in range(26):
            row,col=divmod(index,7)
            box=(gutters[row][col],round(row*whole.height/4),gutters[row][col+1],round((row+1)*whole.height/4))
            frames.append(whole.crop(box))
    else:
        frames=[]
        for source_page in src:
            pix=source_page.get_pixmap(matrix=fitz.Matrix(1600/source_page.rect.width,1600/source_page.rect.width),colorspace=fitz.csRGB,alpha=False)
            frames.append(Image.frombytes('RGB',(pix.width,pix.height),pix.samples))
    thumbs=[]
    for index,frame in enumerate(frames):
        encoded=encode(frame)
        image_name=f'{stem}-page-{index+1:02}.jpg'
        (PREVIEWS/image_name).write_bytes(encoded)
        width=595.5
        height=width*frame.height/frame.width
        dest=pdf.new_page(width=width,height=height)
        dest.insert_image(dest.rect,stream=encoded)
        pages.append({'page':index+1,'image':f'/media/documents/previews/{image_name}','width':frame.width,'height':frame.height,**({'sourcePanel':index,'sourcePage':1} if poster else {'sourcePage':index+1})})
        thumb=Image.new('RGB',(280,438),'#e7e7e7')
        thumb.paste(ImageOps.contain(frame,(272,406)),(4,25))
        ImageDraw.Draw(thumb).text((8,7),f'{index+1:02} | '+('Cover' if poster and index==0 else f'Source panel {index}' if poster else f'Source page {index+1}'),fill='black')
        thumbs.append(thumb)
    name=f'{stem}-web.pdf'
    target=OUT/name
    pdf.set_metadata({'title':'Ideal Makoo — '+('Complete catalogue, paginated web edition' if poster else 'Mould guide, optimized web edition'),'author':'Source branding: Ideal Makoo; web adaptation by site team','subject':'Derived from the user-supplied original PDF. Visual content retained. Undated archival reference; not evidence of current supply or certification.','creator':'Ideal Makoo site reference-document preparation','keywords':'derived web edition, Ideal Makoo, user supplied, source retained'})
    pdf.save(target,garbage=4,deflate=True)
    sheet=Image.new('RGB',(4*280,((len(thumbs)+3)//4)*438),'#f2f2f2')
    for index,thumb in enumerate(thumbs): sheet.paste(thumb,((index%4)*280,(index//4)*438))
    sheet.save(QA/f'{stem}-contact-sheet.jpg',quality=90)
    # Rendering the authored output validates embedded pages, not only the source raster.
    final=fitz.open(target)
    assert len(final)==len(pages)
    for index in ([0,1,11,14,25] if poster else [0,1,11,13]):
        pg=final[index]
        pg.get_pixmap(matrix=fitz.Matrix(1200/pg.rect.width,1200/pg.rect.width)).save(QA/f'{stem}-render-{index+1:02}.png')
    return {'id':stem,'originalFileName':source_name,'sourcePageCount':len(src),'sourceBytes':source.stat().st_size,'sourceSha256':sha(source),'pageCount':len(pages),'webBytes':target.stat().st_size,'webSha256':sha(target),'url':f'/media/documents/{name}','localDownloadUrl':f'/media/documents/{name}','pages':pages}
results=[save_document('ideal makoo neww complete1graynew.pdf','ideal-makoo-complete-catalogue',True),save_document('enigmalife-mould-chart-pdf-Recovered2222-Recovered.pdf','ideal-makoo-mould-guide')]
(OUT/'reference-assets.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
for entry in results:
    print(json.dumps({k:v for k,v in entry.items() if k!='pages'},ensure_ascii=False))
