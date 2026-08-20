/**
 * PedimosCamis? — Descarga + conversión WebP de las imágenes nuevas
 *
 * Detecta los productos añadidos en la última pasada de scraper.js
 * (los últimos N registros de data/products-raw.json, cruzados con
 * data/products.json para excluir lo que categorize.js haya filtrado
 * — p.ej. NFL/Streetwear/Windbreaker), descarga su imagen de Yupoo y
 * la guarda ya redimensionada y convertida a .webp, lista para subir
 * con r2-upload.js.
 *
 * Uso:
 *   node download-new-images.js              // solo los nuevos de la última pasada
 *   node download-new-images.js --all-missing // todos los productos sin .webp local todavía
 *
 * Incremental: si el .webp de un producto ya existe en OUTPUT_DIR, se omite.
 */

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const sharp  = require('sharp');

// ─── Configuración ────────────────────────────────────────────────────────────

const DATA_DIR      = path.join(__dirname, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const RAW_FILE       = path.join(DATA_DIR, 'products-raw.json');
const OUTPUT_DIR    = path.join(__dirname, 'images-nuevas-webp');

const CONCURRENCY   = 6;      // descargas simultáneas
const DELAY_MS      = 250;    // pausa entre lotes
const MAX_WIDTH     = 1000;   // redimensiona si es más ancha que esto
const WEBP_QUALITY  = 82;

const YUPOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer':    'https://ggjersey.x.yupoo.com/',
  'Accept':     'image/webp,image/avif,image/*,*/*;q=0.8',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchBuffer(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: YUPOO_HEADERS, timeout: 15000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return fetchBuffer(res.headers.location, redirects - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('Timeout')); });
  });
}

async function downloadAndConvert(product, retries = 3) {
  const destPath = path.join(OUTPUT_DIR, `${product.id}.webp`);
  if (fs.existsSync(destPath)) return { id: product.id, status: 'skip' };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const buffer = await fetchBuffer(product.img);
      await sharp(buffer)
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toFile(destPath);
      return { id: product.id, status: 'ok' };
    } catch (err) {
      if (attempt === retries) return { id: product.id, status: 'error', error: err.message };
      await sleep(800 * attempt);
    }
  }
}

// ─── Selección de productos "nuevos" ───────────────────────────────────────────

function getTargetProducts() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
  const byId      = new Map(products.map(p => [String(p.id), p]));

  const allMissing = process.argv.includes('--all-missing');
  if (allMissing) {
    return products.filter(p => p.img && p.img.includes('yupoo.com'));
  }

  // Los productos nuevos son los últimos N registros de products-raw.json
  // (el scraper hace merged = [...existing, ...enriched] y guarda al final).
  const raw = JSON.parse(fs.readFileSync(RAW_FILE, 'utf-8'));

  // Nº de nuevos: se puede pasar por --count=N, si no se detecta por el log del scraper.
  const countArg = process.argv.find(a => a.startsWith('--count='));
  const newCount = countArg ? parseInt(countArg.split('=')[1], 10) : 1102;

  const newRaw = raw.slice(-newCount);
  const targets = [];
  for (const r of newRaw) {
    const p = byId.get(String(r.id));
    if (p && p.img && p.img.includes('yupoo.com')) targets.push(p);
  }
  return targets;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const targets = getTargetProducts();
  console.log('=== PedimosCamis? — Descarga + WebP de imágenes nuevas ===');
  console.log(`Productos a procesar: ${targets.length}`);
  console.log(`Carpeta destino:      ${OUTPUT_DIR}`);
  console.log(`Tamaño máx.:          ${MAX_WIDTH}px de ancho, calidad ${WEBP_QUALITY}\n`);

  let ok = 0, skip = 0, error = 0;
  const errors = [];

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(p => downloadAndConvert(p)));

    for (const r of results) {
      if (r.status === 'ok') ok++;
      else if (r.status === 'skip') skip++;
      else { error++; errors.push(r); }
    }

    if ((i + CONCURRENCY) % 100 < CONCURRENCY || i + CONCURRENCY >= targets.length) {
      console.log(`  [${Math.min(i + CONCURRENCY, targets.length)}/${targets.length}] ok:${ok} omitidos:${skip} error:${error}`);
    }

    await sleep(DELAY_MS);
  }

  console.log('\n=== Completado ===');
  console.log(`OK:       ${ok}`);
  console.log(`Omitidos: ${skip} (ya existían)`);
  console.log(`Errores:  ${error}`);
  if (errors.length > 0) {
    console.log('\nProductos con error (reintenta ejecutando el script de nuevo):');
    errors.slice(0, 20).forEach(e => console.log(`  ${e.id}: ${e.error}`));
    if (errors.length > 20) console.log(`  ... y ${errors.length - 20} más`);
  }
  console.log(`\nSiguiente paso: sube ${OUTPUT_DIR} con r2-upload.js (o r2-upload-mascamis.js) ajustando IMAGES_DIR.`);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
