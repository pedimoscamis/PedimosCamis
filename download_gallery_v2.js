'use strict';
/**
 * download_gallery_v2.js — Descarga masiva de fotos de álbum Yupoo (v2, Mac)
 *
 * Para cada producto sin gallery (y con yupooUrl):
 *   - Descarga hasta 4 fotos del álbum (portada + 3 más)
 *   - Las convierte a .webp de alta calidad con sharp (sin recorte de calidad)
 *   - Las sube a R2 bajo mascamis/{id}_photoN_resultado.webp
 *   - Actualiza products.json: gallery = [photo2, photo3, photo4]
 *     Si el producto está en el set "baja calidad" (--requeue-cover-ids),
 *     también reemplaza el campo img por la nueva foto1 (portada) recién
 *     descargada en buena calidad.
 *
 * Reanudable: guarda checkpoint en products.json cada 25 productos y omite
 * los que ya tengan gallery.
 *
 * Uso:
 *   node download_gallery_v2.js --limit 10          (prueba)
 *   node download_gallery_v2.js                     (todo lo pendiente)
 *   node download_gallery_v2.js --id 231537722       (un producto concreto)
 */

const fetch   = require('node-fetch');
const cheerio = require('cheerio');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const sharp   = require('sharp');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

// ─── Configuración ────────────────────────────────────────────────────────────

const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const LOWQ_KEYS_FILE = path.join(__dirname, 'data', 'r2-uploaded-keys.json'); // set de "baja calidad" a re-portada
const TMP_DIR        = path.join(__dirname, '.gallery-tmp');
const R2_PUBLIC_BASE = 'https://pub-30dab6e51e0742a4bf695b05b150982a.r2.dev';
const R2_PREFIX      = 'mascamis';

const BUCKET     = 'pedimoscamis';
const ENDPOINT   = 'https://6600c8fee14f863b13c7b9bba8869364.r2.cloudflarestorage.com';
const ACCESS_KEY = '566df4f751d6f3d8ac1d94839f034bcd';
const SECRET_KEY = '26e30e0384e4fff6678c8b32c1f266ac8868c89c231aa2d3165335156a4794da';

const WEBP_QUALITY = 92;      // alta calidad, sin recorte agresivo
const MAX_WIDTH     = 1600;   // solo limita tamaños desproporcionados, no reduce fotos normales
const DELAY_MS       = 700;   // pausa entre álbumes (por worker)
const CHECKPOINT_EVERY = 25;
const CONCURRENCY    = 6;     // álbumes procesados en paralelo

const client = new S3Client({
  region: 'auto',
  endpoint: ENDPOINT,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  forcePathStyle: false,
});

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT    = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const idIdx    = args.indexOf('--id');
const FILTER_ID = idIdx !== -1 ? args[idIdx + 1] : null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout: 20000,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt < retries) await sleep(2000 * attempt);
      else return null;
    }
  }
}

function fetchBuffer(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https') ? https : http;
    transport.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/webp,image/avif,image/*,*/*;q=0.8',
        'Referer': 'https://www.yupoo.com/',
      },
      timeout: 20000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return fetchBuffer(res.headers.location, redirects - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('Timeout')); });
  });
}

function normalizeImgUrl(url) {
  let u = url.split('?')[0];
  u = u.replace(/\/(small|medium|large|huge|square|thumb)\.(jpg|jpeg|png|webp)$/i, '/large.jpg');
  return u || null;
}

function extractAlbumImages(html, n = 4) {
  const $ = cheerio.load(html);
  const urls = [];
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

async function objectExists(key) {
  try { await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true; }
  catch (e) { if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound') return false; throw e; }
}

async function convertAndUpload(buffer, key) {
  const webp = await sharp(buffer)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
  await client.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: webp,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return webp.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// Las "5 grandes ligas" + Segunda Estrella (España 2 estrellas) — el resto del
// catálogo queda fuera de esta pasada a petición explícita del usuario.
const BIG5_CATS   = new Set(['laliga', 'premier', 'seriea', 'bundesliga', 'ligue1']);
const SPAIN_RE    = /\bspain\b|\bespaña\b|\bespana\b/i;
const TWO_STAR_RE = /2\s*-?\s*stars?\b|2\s*estrellas?\b/i;
const isSpainTwoStar = p => SPAIN_RE.test(p.nameEn || '') && TWO_STAR_RE.test(p.nameEn || '');
const isBig5OrTwoStar = p => (p.cats || []).some(c => BIG5_CATS.has(c)) || isSpainTwoStar(p);

async function main() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
  const lowQIds = new Set(
    JSON.parse(fs.readFileSync(LOWQ_KEYS_FILE, 'utf-8')).map(k => k.replace(/\.webp$/, ''))
  );

  let pending = products.filter(p => {
    if (!p.yupooUrl) return false;
    if (FILTER_ID) return p.id === FILTER_ID;
    if ((p.cats || []).includes('nba')) return false;
    if (!isBig5OrTwoStar(p)) return false;
    return !p.gallery || p.gallery.length === 0;
  });
  if (isFinite(LIMIT)) pending = pending.slice(0, LIMIT);

  console.log(`Pendientes a procesar: ${pending.length} (de ${products.length} totales)`);
  console.log(`De baja calidad (se re-descarga también la portada): ${pending.filter(p => lowQIds.has(p.id)).length}\n`);

  let ok = 0, noPhotos = 0, errors = 0, done = 0;

  async function processOne(p, i) {
    const replaceCover = lowQIds.has(p.id);
    const label = (p.nameEn || p.nameEs || p.id).slice(0, 60);
    console.log(`[${i + 1}/${pending.length}] ${p.id}  ${label}${replaceCover ? '  (re-portada)' : ''}`);

    const html = await fetchPage(p.yupooUrl);
    if (!html) { console.log(`  ⚠ [${p.id}] página no cargó, omitido`); errors++; return; }

    const imgUrls = extractAlbumImages(html, 4); // siempre pedimos 4, la 1ª es portada
    if (imgUrls.length === 0) { console.log(`  ⚠ [${p.id}] sin imágenes en el álbum, omitido`); noPhotos++; return; }

    const gallery = [];
    let newCoverUrl = null;
    const startIdx = replaceCover ? 0 : 1; // si no hace falta portada, saltamos la 1ª (=portada actual)

    for (let j = startIdx; j < imgUrls.length; j++) {
      const photoN = j + 1; // photo1 = portada, photo2.. = galería
      const key = `${R2_PREFIX}/${p.id}_photo${photoN}_resultado.webp`;
      try {
        if (await objectExists(key)) {
          console.log(`  ✓ [${p.id}] ${key} ya existe en R2`);
        } else {
          const buffer = await fetchBuffer(imgUrls[j]);
          const size = await convertAndUpload(buffer, key);
          console.log(`  ↑ [${p.id}] ${key} (${(size / 1024).toFixed(0)} KB)`);
        }
        const url = `${R2_PUBLIC_BASE}/${key}`;
        if (photoN === 1) newCoverUrl = url; else gallery.push(url);
      } catch (err) {
        console.warn(`  ✗ [${p.id}] foto${photoN}: ${err.message}`);
      }
    }

    const prod = products.find(x => x.id === p.id);
    if (prod) {
      if (gallery.length > 0) prod.gallery = gallery;
      if (newCoverUrl) prod.img = newCoverUrl;
    }
    if (gallery.length > 0 || newCoverUrl) { ok++; console.log(`  ✅ [${p.id}] listo`); }
    else { errors++; console.log(`  ✗ [${p.id}] nada descargado`); }
  }

  // Pool de workers concurrentes: cada uno toma el siguiente producto de la
  // cola en cuanto termina el suyo, en vez de esperar turno secuencialmente.
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < pending.length) {
      const i = nextIdx++;
      await processOne(pending[i], i);
      done++;
      if (done % CHECKPOINT_EVERY === 0) {
        fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
        console.log(`💾 Checkpoint (${done}/${pending.length})`);
      }
      await sleep(DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
  console.log(`\n=== RESUMEN === OK: ${ok}  Sin fotos: ${noPhotos}  Errores: ${errors}`);
}

main().catch(err => { console.error('Error fatal:', err); process.exit(1); });
