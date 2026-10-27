# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

PedimosCamis? (`pedimoscamis.com`): tienda de camisetas de fútbol/NBA como SPA en JavaScript vanilla, sin build ni framework. El README la describe como proyecto personal/portfolio; el sitio está oculto a buscadores a propósito (`noindex`, cabecera `X-Robots-Tag` en el deploy). Idioma de trabajo: español (commits, comentarios, UI).

## Comandos

```bash
npm start                  # node server.js → http://localhost:3000 (también: preview "pedimoscamis-dev" en .claude/launch.json)
node scraper.js            # Fase 1+2: scrapea Yupoo → data/products-raw.json (caché, gitignored)
node categorize.js         # products-raw.json → data/products.json (cats, tallas, precio)
node scripts/build-share-pages.js _site   # genera p/<id>.html con Open Graph (solo se hace en el deploy)
```

No hay tests ni linter. La comprobación mínima tras editar `index.html` es sintaxis del `<script>` y abrirlo en el preview (consola sin errores). Hay un one-liner de `node -e` con `new Function(src)` ya permitido en `.claude/settings.local.json`.

## Arquitectura

- **`index.html` (~9.000 líneas)** contiene TODO el frontend: CSS, HTML y JS en un solo archivo. Carga `data/products.json` por fetch (`PRODUCTS_URL`) y renderiza filas/rejilla/modales/carrito en cliente. Constantes de negocio al principio del bloque JS: `DISCOUNT_CODES`, `SOCIO_CODES`, `NORMAL_PRICES`/`NORMAL_JERSEY`/`NORMAL_RETRO`, `SHIPPING_*`, `EUR_RATE`, `UCL_DISCOUNT`, `SUPER_FLASH_*`, `WEBHOOK_URL`, `NOMBRE_TRANSLATIONS`.
  - Dos modos de precio: **normal** (precios fijos en € por tipo: camiseta, retro, niño, mujer, NBA, cortavientos) y **socio** (código de acceso; `priceUsd` × `EUR_RATE`). Cambiar precios exige tocar `index.html` Y revisar `apps-script/` (el Sheet calcula costes/márgenes con los mismos valores: envío real 4,50 €, tax aduana 2,66 €, envío gratis a partir de N camisetas).
  - Los nombres se traducen solo al mostrarlos (`NOMBRE_TRANSLATIONS`); `nameEn` en `products.json` no se toca. `scripts/build-share-pages.js` extrae ese array de `index.html` con una regex, así que mantén la forma `const NOMBRE_TRANSLATIONS = [ ... \n];`.
  - Enlace compartible `?p=<id>` abre el producto; `/p/<id>.html` son páginas estáticas con OG que redirigen a `../?p=<id>`.
- **`data/products.json` (~12.700 productos)** es la "base de datos". Campos: `id` (id de álbum Yupoo, string), `nameEs/nameEn`, `cats[]`, `type`, `priceUsd`, `img`, `gallery[]`, `photos`, `sizes[]`, `supplier`, `yupooUrl`, `addedAt`. `products.json.bak` es copia manual.
- **Pipeline de catálogo**: Yupoo → `scraper.js` → `products-raw.json` → `categorize.js` → `products.json`. El workflow `update-catalog.yml` ya no usa el scraper: lo ejecuta el **agente de catálogo** (`agent/`, ver `agent/README.md`) los días 1 y 15 de cada mes. Añade solo lo nuevo de ggjersey (5 ligas, selecciones y clubes europeos de `agent/teams.js`), nunca modifica productos existentes ni deja `img: null`; las fotos van a R2 como `mascamis/{id}_photoN_resultado.webp` (portada + 3). Necesita los secretos `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`. Tras tocar `agent/teams.js` o `agent/parse.js` ejecuta `npm run agent:test`.
- **Nuevo proveedor** (flujo en etapas, cada una lee/escribe `data/newsupplier-*.json`): `scraper-newsupplier-list.js` → `compare-newsupplier.js` (solo grandes ligas; actual por equipo+tipo, retro por equipo+temporada) → `import-newsupplier.js` (entra SIN imágenes, reutiliza la lógica copiada de `categorize.js`) → `download-newsupplier-images.js` (portada + 1 foto, a webp, sube a R2; reanudable, checkpoint cada 25).
- **Imágenes**: viven en Cloudflare R2 (bucket `pedimoscamis`) y se sirven por `https://img.pedimoscamis.com/...` (dominio propio; no uses `pub-*.r2.dev` ni Yupoo en `products.json`: Yupoo da 567 sin Referer y un Worker intermedio ya se revirtió por caerse). Rutas: raíz `{id}.webp` o `mascamis/{id}_photoN_resultado.webp`. Cloudinary es el CDN anterior (`upload-/apply-/fix-cloudinary.js`, `data/cloudinary-progress.json`); legado. Los scripts `r2-upload*.js` y `migrate-yupoo-hotlinks.js` son reanudables (HEAD antes de PUT; `data/r2-uploaded-keys.json`).
- **`server.js`**: Express estático + `/proxy?url=` solo para dominios Yupoo (desarrollo). No se despliega.
- **`apps-script/`**: backend serverless en Google Apps Script (`codigo-principal.gs` = `doPost` de pedidos → Sheet + correos; `cuentas.gs` = códigos de acceso y "Mi cuenta"). Se pega a mano en el editor de Apps Script (no hay clasp); tras cambiarlo hay que redesplegar la web app y, si cambia la URL, actualizar `WEBHOOK_URL` en `index.html`.

## Deploy

`push` a `main` → `.github/workflows/deploy.yml` construye `_site` (copia `index.html`, manifest, iconos, `data/products.json`, genera `p/`, escribe `_headers` noindex) y publica con wrangler en Cloudflare Pages (proyecto `pedimoscamis`, dominio `pedimoscamis.com`). Solo esos archivos llegan a producción: cualquier asset nuevo que el HTML necesite debe añadirse al paso "Preparar sitio estático". Secrets `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` en GitHub. Se trabaja directo sobre `main` con commits en español descriptivos.

## Cuidado

- Los scripts `r2-upload*.js`, `migrate-yupoo-hotlinks.js` y `scripts/upload-2627.mjs` tienen las claves de R2 escritas en el código; `.env` guarda Cloudinary. No copies esas claves a nuevos archivos ni a commits; para scripts nuevos léelas de `.env` (`dotenv` ya es dependencia). Las rutas de entrada de varios scripts son locales de Windows (`C:/Users/Alfonso/Downloads/...`, `H:\...`).
- `cloudflare.txt` (sin versionar) contiene credenciales; no lo subas.
- `data/products.json` se edita a menudo con `node -e`; haz copia o revisa `git diff --stat` antes de escrituras masivas, y no dejes `img: null` en productos que ya tenían imagen.
- `.claude/launch.json` usa la ruta de Node de Windows (`C:/Program Files/nodejs/node.exe`).

## Skills del proyecto

En `.claude/skills/`: `verificar-sitio`, `desplegar-sitio`, `anadir-productos`, `subir-imagenes-r2`, `precios-y-pedidos`. Úsalas para esos flujos en lugar de redescubrirlos.
