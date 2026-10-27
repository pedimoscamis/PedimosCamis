---
name: verificar-sitio
description: Verifica cambios en PedimosCamis (index.html, data/products.json, CSS/JS de la tienda) antes de commitear. Úsala tras editar el frontend o el catálogo.
---

# Verificar el sitio en local

1. **Sintaxis del JS inline** (index.html es un único archivo):
   ```bash
   node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf-8');const s=h.match(/<script[\s\S]*?<\/script>/g)||[];const src=s.map(b=>b.replace(/<\/?script[^>]*>/g,'')).join('\n');try{new Function(src);console.log('OK')}catch(e){console.error('ERROR:',e.message)}"
   ```
2. **Catálogo válido** si tocaste `data/products.json`: `node -e "const p=require('./data/products.json');console.log(p.length, p.filter(x=>!x.img).length+' sin img')"` y compara con `git diff --stat` (el nº de productos y de `img: null` no debe subir sin motivo).
3. **Preview**: `preview_start` con `pedimoscamis-dev` (puerto 3000), luego `read_console_messages` (sin errores) y un `screenshot` o `read_page` de la zona cambiada. Para producto concreto: `/?p=<id>`.
4. Si el cambio afecta a móvil, `resize_window` preset `mobile`; el diseño es mobile-first.
5. Si tocaste `NOMBRE_TRANSLATIONS`, ejecuta `node scripts/build-share-pages.js $TEMP/_site` para asegurar que la regex sigue extrayéndolo.

Comprueba que las imágenes cargan desde `img.pedimoscamis.com` (pestaña de red), no desde Yupoo ni `pub-*.r2.dev`.
