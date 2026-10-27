---
name: subir-imagenes-r2
description: Convierte y sube imágenes de productos a Cloudflare R2 (bucket pedimoscamis, servido en img.pedimoscamis.com) y actualiza products.json. Úsala al añadir o reparar imágenes.
---

# Imágenes en R2

- Bucket `pedimoscamis`; público vía `https://img.pedimoscamis.com/<key>`. Las credenciales y el endpoint están en la memoria `reference_r2` y en los scripts `r2-upload*.js`; para scripts nuevos léelas de `.env` con `dotenv` en lugar de copiarlas al código, y no las pegues en commits ni en la salida.
- Formato: webp (`sharp`), `ContentType: image/webp`, `Cache-Control` de 1 año. Claves: `{id}.webp` en la raíz (catálogo base) o `mascamis/{id}_photoN_resultado.webp` (proveedor nuevo/galerías).
- Yupoo exige `Referer: https://www.yupoo.com/` al descargar y no se puede enlazar directo desde la tienda (`migrate-yupoo-hotlinks.js` repara portadas que aún apunten ahí).

## Pasos
1. Descarga/convierte: `download-images.js`, `download-new-images.js`, `download_gallery_v2.js` o `download-newsupplier-images.js` según el origen (revisa la ruta de entrada local del script).
2. Sube con el script adecuado (`r2-upload.js`, `r2-upload-new-catalog.js`, `r2-upload-mascamis.js`); todos hacen HEAD antes de PUT, así que se pueden relanzar.
3. Actualiza `img`/`gallery` en `data/products.json` con URLs `https://img.pedimoscamis.com/...` (nunca `pub-*.r2.dev`).
4. Comprueba una muestra: `curl -o /dev/null -s -w "%{http_code}" <url>` debe dar 200.
5. Revisa `git diff --stat data/products.json` y ejecuta `verificar-sitio`.
