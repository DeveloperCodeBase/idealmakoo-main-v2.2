# Transparent factory brand asset

- Source identity: https://idealmakoo.com/images/logo.png. The original downloaded raster is retained as `public/media/official/logo.png`.
- Website asset: `public/media/brand/logo-transparent.png`, 256 × 235, PNG with true alpha (transparent pixels alpha 0; opaque pixels alpha 255).
- The white background was extracted with built-in imagegen, keeping the existing apple symbol. The result was resized with Sharp for the small website navigation image; no glow or background is baked into the PNG. Dark and light contrast is handled in CSS.
- The imagegen source remains in the conversation output. This website asset is a derived presentation asset, not a new factory certification or product photograph.
- Brand settings accept a replacement PNG/JPEG/WebP of up to 512 KiB or a local raster asset. SVG/HTML, remote URLs, malformed signatures and oversized data are rejected.

## Image edit prompt

Use case: background-extraction. Edit target: the supplied official Ideal Makoo company apple logo, a red apple with green leaf and stem and a distinctive bite/cutout on its left side. Primary request: remove only the white background around the logo and in the cutout, producing a genuinely transparent PNG asset for use on both a dark and a light website navbar. Preserve the original apple shape, proportions, leaf/stem, highlights, colors, bite silhouette, and every identifying detail exactly. Keep the full logo uncropped, centered, a small transparent margin. No redesign, no new text, no shadows behind it, no glow baked into the image, no extra objects. The background must have real alpha transparency, not a checkerboard or solid background. This is a precise extraction of the provided existing brand, not a new logo design.
