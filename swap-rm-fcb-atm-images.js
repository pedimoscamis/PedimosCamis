'use strict';
/**
 * Sustituye SOLO las imágenes (img + gallery) de los productos existentes
 * (proveedor antiguo) de Real Madrid, Barcelona y Atlético Madrid de la
 * temporada 26/27 — únicamente sus equipaciones estándar (local/visitante/
 * tercera) — por las fotos equivalentes del nuevo proveedor. No crea, borra
 * ni renombra ningún producto: solo actualiza img/gallery/photos en los ids
 * ya existentes, verificados visualmente uno a uno contra el diseño real.
 */
const fetch   = require('node-fetch');
const cheerio = require('cheerio');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const sharp   = require('sharp');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const NEWSUP_RAW     = path.join(__dirname, 'data', 'newsupplier-raw.json');
const WORKER_BASE    = 'https://kitzone-images.alfonsohgolderos.workers.dev';
const R2_PREFIX      = 'mascamis';

const BUCKET     = 'pedimoscamis';
const ENDPOINT   = 'https://6600c8fee14f863b13c7b9bba8869364.r2.cloudflarestorage.com';
const ACCESS_KEY = '566df4f751d6f3d8ac1d94839f034bcd';
const SECRET_KEY = '26e30e0384e4fff6678c8b32c1f266ac8868c89c231aa2d3165335156a4794da';
const WEBP_QUALITY = 92;
const MAX_WIDTH     = 1600;

const client = new S3Client({
  region: 'auto', endpoint: ENDPOINT,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  forcePathStyle: false,
});

// existingProductId -> id del álbum del nuevo proveedor verificado visualmente
const MAPPING = [
  { existing: '231561209', newAlbum: '229039928', label: 'Real Madrid Home' },
  { existing: '251838472', newAlbum: '253502911', label: 'Real Madrid Away (verde)' },
  { existing: '249542421', newAlbum: '238769063', label: 'Real Madrid Third (rosa, antes mal etiquetado como "Second Away")' },
  { existing: '249539957', newAlbum: '237045723', label: 'Barcelona Home' },
  { existing: '249543369', newAlbum: '253502907', label: 'Barcelona Away (x Kobe Bryant, negro/morado)' },
  { existing: '249543397', newAlbum: '245320989', label: 'Barcelona Third (turquesa, antes mal etiquetado como "Second Away")' },
  { existing: '251838618', newAlbum: '253503457', label: 'Atlético Madrid Home' },
  { existing: '249544242', newAlbum: '245320333', label: 'Atlético Madrid Away' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
        timeout: 20000,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt < retries) await sleep(2000 * attempt); else return null;
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
  $('img[src*="photo.yupoo.com"], img[data-src*="photo.yupoo.com"]').each((_, el) => {
    if (urls.length >= n) return false;
    let src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (!src) return;
    src = normalizeImgUrl(src);
    if (src && !urls.includes(src)) urls.push(src);
  });
  return urls;
}

async function convertAndUpload(buffer, key) {
  const webp = await sharp(buffer).resize({ width: MAX_WIDTH, withoutEnlargement: true }).webp({ quality: WEBP_QUALITY }).toBuffer();
  await client.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: webp, ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return webp.length;
}

async function main() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
  const raw = JSON.parse(fs.readFileSync(NEWSUP_RAW, 'utf-8'));

  for (const m of MAPPING) {
    const prod = products.find(p => p.id === m.existing);
    const album = raw.find(a => a.id === m.newAlbum);
    if (!prod) { console.warn('⚠ Producto existente no encontrado:', m.existing); continue; }
    if (!album) { console.warn('⚠ Álbum nuevo no encontrado:', m.newAlbum); continue; }

    console.log(`\n[${m.label}] ${prod.nameEn}  (${m.existing} <- ${m.newAlbum})`);
    const html = await fetchPage(album.yupooUrl);
    if (!html) { console.warn('  ⚠ no se pudo cargar el álbum, omitido'); continue; }
    const imgUrls = extractAlbumImages(html, 4);
    if (imgUrls.length === 0) { console.warn('  ⚠ sin imágenes, omitido'); continue; }

    // Sufijo de versión: este script SIEMPRE sustituye una imagen que ya
    // existía (a diferencia de download-newsupplier-images.js, que sube
    // fotos de productos nuevos). Reutilizar la misma key con
    // Cache-Control: immutable deja a cualquier navegador que ya la hubiera
    // visto con la foto vieja en caché para siempre — así que cada
    // sustitución usa una key nueva.
    const version = Date.now();
    const gallery = [];
    let coverUrl = null;
    for (let j = 0; j < imgUrls.length; j++) {
      const photoN = j + 1;
      const key = `${R2_PREFIX}/${prod.id}_photo${photoN}_v${version}_resultado.webp`;
      try {
        const buffer = await fetchBuffer(imgUrls[j]);
        const size = await convertAndUpload(buffer, key);
        console.log(`  ↑ ${key} (${(size / 1024).toFixed(0)} KB)`);
        const url = `${WORKER_BASE}/${key}`;
        if (photoN === 1) coverUrl = url; else gallery.push(url);
      } catch (err) {
        console.warn(`  ✗ foto${photoN}: ${err.message}`);
      }
      await sleep(300);
    }

    if (coverUrl) {
      prod.img = coverUrl;
      if (gallery.length > 0) prod.gallery = gallery;
      prod.photos = (coverUrl ? 1 : 0) + gallery.length;
      console.log(`  ✅ actualizado`);
    } else {
      console.warn('  ✗ no se pudo obtener portada, producto NO modificado');
    }
    await sleep(600);
  }

  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
  console.log('\n=== Guardado ===');
}

main().catch(err => { console.error('Error fatal:', err); process.exit(1); });
