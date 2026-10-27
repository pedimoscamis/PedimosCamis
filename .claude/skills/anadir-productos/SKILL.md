---
name: anadir-productos
description: Añade o actualiza productos del catálogo (data/products.json) desde Yupoo o un proveedor nuevo, con sus imágenes en R2. Úsala para importar camisetas, quitar duplicados o rehacer categorías.
---

# Añadir / mantener productos

Contexto: `data/products.json` es la fuente de verdad; `id` = id de álbum de Yupoo (string). Lee `CLAUDE.md` para el modelo de datos.

## Antes de nada
- `cp data/products.json data/products.json.bak` y apunta el nº de productos.
- Nunca ejecutes `scraper.js` + `categorize.js` sobre el catálogo actual sin revisar el diff: el scraper deja `img: null` en lo ya migrado a R2.

## Proveedor nuevo (flujo por etapas, reanudable)
1. `node scraper-newsupplier-list.js` → `data/newsupplier-raw.json` (solo listado).
2. `node compare-newsupplier.js` → `data/newsupplier-candidates.json`. Revisa el informe: solo grandes ligas; temporada actual se compara por equipo+tipo, retro por equipo+temporada exacta.
3. `node import-newsupplier.js` → añade entradas sin imagen y guarda ids en `data/newsupplier-new-ids.json`.
4. `node download-newsupplier-images.js --limit 10` (prueba) y luego sin `--limit`. Sube a R2 (ver skill `subir-imagenes-r2`) y rellena `img`/`gallery` con URLs `https://img.pedimoscamis.com/mascamis/{id}_photoN_resultado.webp`. Solo 2 fotos por producto (las 3/4 de este proveedor enseñan su web).

## Catálogo 26/27 de jerseyxie
`scripts/download-2627.mjs` → `scripts/upload-2627.mjs` (genera `scripts/new-products-2627.json`) → fusionar en `products.json`.

## Reglas de catálogo
- Categorización, tallas y precio salen de `categorize.js`; reutiliza esa lógica (no la reinventes). Los productos nuevos deben ser indistinguibles de los scrapeados.
- Second Away cuenta como tercera equipación; "Special/Especial" en el nombre va a la categoría virtual Ediciones Especiales.
- Evita duplicados (mismo kit con dos anuncios): ya se limpiaron 109+23 en el pasado.
- Si un producto debe ocultarse de destacadas, usa `FEATURED_EXCLUDE_IDS` en `index.html` en vez de borrarlo.

## Al terminar
Cuenta productos, `img` null y URLs que no empiecen por `https://img.pedimoscamis.com/`; ejecuta `verificar-sitio`; muestra al usuario el resumen (+N / −N) antes de commitear.
