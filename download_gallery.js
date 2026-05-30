/**
 * download_gallery.js — Descarga 3 fotos extra por producto desde Yupoo
 *
 * Flujo:
 *  1. Lee data/products.json
 *  2. Por cada producto con yupooUrl (sin gallery ya asignado):
 *     - Visita la página del álbum con node-fetch + cheerio
 *     - Extrae las URLs de las 3 primeras imágenes del álbum
 *     - Las descarga en H:\mascamis como {id}_photo1.jpg … _photo3.jpg
 *  3. Inyecta en cada producto un array "gallery" con las URLs definitivas de R2
 *     Formato: https://pub-30dab6e51e0742a4bf695b05b150982a.r2.dev/galeria/{id}_photo1.jpg
 *  4. Guarda products.json con checkpoint cada 50 productos
 *
 * Incremental: omite productos que ya tengan gallery[] con entradas.
 *
 * Uso:
 *   node download_gallery.js                 → todos los productos sin galería
 *   node download_gallery.js --limit 20      → solo los primeros 20 pendientes
 *   node download_gallery.js --id 231537722  → solo ese producto (útil para pruebas)
 */

'use strict';
const fetch   = require('node-fetch');
const cheerio = require('cheerio');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');

// ─── Configuración ────────────────────────────────────────────────────────────

const PRODUCTS_FILE    = path.join(__dirname, 'data', 'products.json');
const DOWNLOAD_DIR     = 'H:\\mascamis';
const R2_BASE          = 'https://pub-30dab6e51e0742a4bf695b05b150982a.r2.dev/galeria';
const PHOTOS_PER_ALBUM = 3;
const DELAY_MS         = 1200; // ms entre álbumes para no saturar el servidor

// ─── Argumentos CLI ───────────────────────────────────────────────────────────

const args      = process.argv.slice(2);
const limitIdx  = args.indexOf('--limit');
const LIMIT     = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const idIdx     = args.indexOf('--id');
const FILTER_ID = idIdx !== -1 ? args[idIdx + 1] : null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Connection':      'keep-alive',
        },
        timeout: 20000,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      console.warn(`  [Intento ${attempt}/${retries}] ${err.message}`);
      if (attempt < retries) await sleep(2000 * attempt);
    }
  }
  return null;
}

function downloadFile(url, destPath, retries = 3) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error('URL inválida: ' + url)); }

    const attempt = (n) => {
      const transport = parsed.protocol === 'https:' ? https : http;
      const req = transport.request(
        {
          hostname: parsed.hostname,
          path:     parsed.pathname + parsed.search,
          method:   'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept':     'image/webp,image/avif,image/*,*/*;q=0.8',
            'Referer':    'https://www.yupoo.com/',
          },
        },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            const loc = res.headers['location'];
            if (loc) { res.resume(); try { parsed = new URL(loc); } catch {} return attempt(n); }
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          const file = fs.createWriteStream(destPath);
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
          file.on('error', (err) => { try { fs.unlinkSync(destPath); } catch {} reject(err); });
        }
      );
      req.on('error', (err) => {
        if (n < retries) setTimeout(() => attempt(n + 1), 1000 * n);
        else reject(err);
      });
      req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    };
    attempt(1);
  });
}

/**
 * Extrae hasta `n` URLs de imágenes de la página HTML de un álbum Yupoo.
 * Devuelve las URLs normalizadas a calidad "large" para la galería.
 */
function extractAlbumImages(html, n = 3) {
  const $ = cheerio.load(html);
  const urls = [];

  // Selector principal — foto.yupoo o img.yupoo con src o data-src
  const imgEls = $(
    'img[src*="photo.yupoo.com"], img[src*="img.yupoo.com"],' +
    'img[data-src*="photo.yupoo.com"], img[data-src*="img.yupoo.com"]'
  );

  imgEls.each((_, el) => {
    if (urls.length >= n) return false;
    let src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (!src) return;
    src = normalizeImgUrl(src);
    if (src && !urls.includes(src)) urls.push(src);
  });

  // Fallback: buscar cualquier img si los selectores primarios no encontraron nada
  if (urls.length === 0) {
    $('img').each((_, el) => {
      if (urls.length >= n) return false;
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (!src.includes('photo.yupoo.com') && !src.includes('img.yupoo.com')) return;
      const normalized = normalizeImgUrl(src);
      if (normalized && !urls.includes(normalized)) urls.push(normalized);
    });
  }

  return urls;
}

function normalizeImgUrl(url) {
  // Quitar query params
  let u = url.split('?')[0];
  // Usar calidad "large" para la galería (mejor que "small" que usa el scraper principal)
  u = u.replace(
    /\/(small|medium|large|huge|square|thumb)\.(jpg|jpeg|png|webp)$/i,
    '/large.jpg'
  );
  return u || null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   PedimosCamis? — Descargador de galería v1.0   ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // Crear directorio de descarga si no existe
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    console.log(`📁 Directorio creado: ${DOWNLOAD_DIR}\n`);
  }

  // Leer catálogo
  const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
  console.log(`📦 Productos en catálogo: ${products.length}`);

  // Seleccionar pendientes
  let pending = products.filter(p => {
    if (!p.yupooUrl) return false;
    if (FILTER_ID)   return p.id === FILTER_ID;
    return !p.gallery || p.gallery.length === 0;
  });

  if (pending.length === 0) {
    console.log('✅ Todos los productos ya tienen galería. Nada que hacer.');
    return;
  }
  if (isFinite(LIMIT)) pending = pending.slice(0, LIMIT);

  console.log(`🎯 Productos a procesar: ${pending.length}`);
  console.log(`💾 Descarga en: ${DOWNLOAD_DIR}\n`);

  let ok = 0, noPhotos = 0, errors = 0;

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    const label = (p.nameEn || p.nameEs || p.id).slice(0, 55);
    process.stdout.write(`[${String(i + 1).padStart(4)}/${pending.length}] ${p.id}  ${label}\n`);

    // 1. Obtener HTML del álbum
    const html = await fetchPage(p.yupooUrl);
    if (!html) {
      console.log('  ⚠️  No se pudo cargar la página → omitido\n');
      errors++;
      await sleep(DELAY_MS);
      continue;
    }

    // 2. Extraer URLs de imagen
    const imgUrls = extractAlbumImages(html, PHOTOS_PER_ALBUM);
    if (imgUrls.length === 0) {
      console.log('  ⚠️  Sin imágenes detectadas en el álbum → omitido\n');
      noPhotos++;
      await sleep(DELAY_MS);
      continue;
    }

    // 3. Descargar y construir gallery[]
    const gallery = [];
    for (let j = 0; j < imgUrls.length; j++) {
      const extMatch = imgUrls[j].match(/\.(jpg|jpeg|png|webp)$/i);
      const ext      = extMatch ? extMatch[1].toLowerCase() : 'jpg';
      const filename = `${p.id}_photo${j + 1}.${ext}`;
      const destPath = path.join(DOWNLOAD_DIR, filename);
      const r2Url    = `${R2_BASE}/${filename}`;

      // Si ya existe el archivo en disco, reutilizar
      if (fs.existsSync(destPath)) {
        const size = fs.statSync(destPath).size;
        console.log(`  ✓ ${filename} ya existe (${(size / 1024).toFixed(0)} KB)`);
        gallery.push(r2Url);
        continue;
      }

      try {
        await downloadFile(imgUrls[j], destPath);
        const size = fs.statSync(destPath).size;
        console.log(`  ↓ ${filename} (${(size / 1024).toFixed(0)} KB)`);
        gallery.push(r2Url);
      } catch (err) {
        console.warn(`  ✗ Error foto ${j + 1}: ${err.message}`);
      }
    }

    // 4. Actualizar el producto en el array original
    if (gallery.length > 0) {
      const prod = products.find(x => x.id === p.id);
      if (prod) prod.gallery = gallery;
      ok++;
      console.log(`  ✅ gallery[${gallery.length}] asignado\n`);
    } else {
      errors++;
      console.log('  ✗ No se descargó ninguna imagen\n');
    }

    // Guardar checkpoint cada 50 productos
    if ((i + 1) % 50 === 0) {
      fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
      console.log(`\n💾 Checkpoint guardado (${i + 1}/${pending.length})\n`);
    }

    await sleep(DELAY_MS);
  }

  // Guardado final
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  ✅ OK: ${String(ok).padEnd(6)} ⚠️ Sin fotos: ${String(noPhotos).padEnd(6)} ✗ Errores: ${String(errors).padEnd(4)} ║`);
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`\n📁 Imágenes en: ${DOWNLOAD_DIR}`);
  console.log('📤 Sube las imágenes a R2 en la subcarpeta "galeria/" para activarlas.');
  console.log('   Luego haz git add data/products.json && git commit && git push\n');
}

main().catch(err => {
  console.error('\n💥 Error fatal:', err.message);
  process.exit(1);
});
