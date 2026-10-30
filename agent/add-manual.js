#!/usr/bin/env node
'use strict';
/**
 * Altas manuales al catálogo: productos que se pasan a mano (no la importación
 * automática de ggjersey). Mismo formato, mismas reglas y mismas imágenes en R2
 * que el agente (parse.js + images.js).
 *
 * Uso:
 *   node agent/add-manual.js <spec.json> --dry-run   (clasifica y comprueba; no sube ni escribe)
 *   node agent/add-manual.js <spec.json>             (sube fotos a R2 y añade a products.json)
 *   Opciones: --force (añade aunque la huella coincida con un producto existente)
 *
 * spec.json: un objeto o un array de objetos
 *   {
 *     "title":  "Real Madrid 26/27 Home Women Fan Version",   // obligatorio, título en inglés estilo proveedor
 *     "nameEs": "Real Madrid Local Mujer Fan Version 26/27",  // opcional (por defecto = title)
 *     "yupoo":  "https://<tienda>.x.yupoo.com/albums/123?uid=1", // opcional: id = álbum y fotos del álbum
 *     "images": ["C:/ruta/foto1.jpg", "https://…/2.jpg"],     // opcional: portada primero; sustituye a las de Yupoo
 *     "id":     "…",                                          // opcional (por defecto: álbum de Yupoo o mn+10 hex)
 *     "photos": 4,                                            // opcional: máx. de fotos (portada + 3)
 *     "cats": [...], "priceUsd": 8, "sizes": [...]            // opcional: solo si el clasificador no basta
 *   }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { parseTitle, buildProduct, fingerprint, detectSizes } = require('./parse');

const ROOT = path.join(__dirname, '..');
const PRODUCTS_FILE = path.join(ROOT, 'data', 'products.json');
const PRICES = { normal: 8, retro: 13 };   // convención del catálogo (categorize.js::getPrice)
const VALID_CATS = new Set(['laliga', 'premier', 'seriea', 'bundesliga', 'ligue1', 'europa', 'selecciones',
  'sudamerica', 'nba', 'otros', 'shorts', 'retro', 'nuevatemporada', 'women', 'kids']);

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const FORCE = argv.includes('--force');
const specFile = argv.find(a => !a.startsWith('--'));
if (!specFile) { console.error('Uso: node agent/add-manual.js <spec.json> [--dry-run] [--force]'); process.exit(2); }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ─── Yupoo (cualquier tienda *.x.yupoo.com) ──────────────────────────────────
function parseYupoo(url) {
  const m = String(url).match(/^https?:\/\/([a-z0-9-]+)\.x\.yupoo\.com\/albums\/(\d+)/i);
  if (!m) throw new Error(`URL de Yupoo no reconocida: ${url}`);
  return { shop: `https://${m[1]}.x.yupoo.com`, albumId: m[2] };
}

async function get(url, referer) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: referer || 'https://www.yupoo.com/' }, signal: AbortSignal.timeout(40000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res;
}

/** Fotos del álbum: portada (og:image) primero y después el resto, como el agente. */
async function yupooPhotos(url, n) {
  const { shop, albumId } = parseYupoo(url);
  const html = await (await get(`${shop}/albums/${albumId}?uid=1`, `${shop}/`)).text();
  const $ = cheerio.load(html);
  const pid = u => (String(u).match(/photo\.yupoo\.com\/[^/]+\/([A-Za-z0-9]+)\//) || [])[1] || null;
  const abs = u => (u.startsWith('//') ? `https:${u}` : u);
  const photos = [];
  const seen = new Set();
  $('img.image__img, img[data-origin-src]').each((_, el) => {
    const origin = $(el).attr('data-origin-src') || $(el).attr('data-src') || $(el).attr('src') || '';
    const id = pid(origin);
    if (!id || seen.has(id)) return;
    seen.add(id);
    photos.push({ id, url: abs(origin) });
  });
  const coverId = pid($('meta[property="og:image"]').attr('content') || '');
  const cover = photos.find(p => p.id === coverId);
  const ordered = cover ? [cover, ...photos.filter(p => p !== cover)] : photos;
  return { shop, albumId, urls: ordered.slice(0, n).map(p => p.url), total: photos.length };
}

async function loadImage(src, referer) {
  if (/^https?:\/\//i.test(src)) return Buffer.from(await (await get(src, referer)).arrayBuffer());
  return fs.readFileSync(src);
}

// ─── Producto ────────────────────────────────────────────────────────────────
function build(spec, id, yupooUrl) {
  const title = String(spec.title || '').replace(/\s+/g, ' ').trim();
  if (!title) throw new Error('falta "title"');
  const t = parseTitle(title, { includeRetro: true, minSeasonStart: 0 });

  let p;
  if (t.verdict === 'include') {
    p = buildProduct(t, { id, yupooUrl, prices: PRICES });
  } else {
    if (!spec.cats) throw new Error(`el clasificador no lo reconoce (${t.verdict}: ${t.reason}); indica "cats" a mano`);
    p = buildProduct({ ...t, scope: spec.cats[0] }, { id, yupooUrl, prices: PRICES });
  }
  if (spec.cats) {
    const bad = spec.cats.filter(c => !VALID_CATS.has(c));
    if (bad.length) throw new Error(`categorías no válidas: ${bad.join(', ')}`);
    p.cats = spec.cats;
    p.yupooCategory = spec.cats.find(c => c !== 'retro') || spec.cats[0];
  }
  p.type = p.cats.includes('retro') ? 'retro' : 'normal';
  p.priceUsd = spec.priceUsd ?? PRICES[p.type];
  p.sizes = spec.sizes || detectSizes(title, t.kids);
  if (spec.nameEs) p.nameEs = spec.nameEs;
  return { p, t };
}

const writeProducts = (products, raw) => {
  const tmp = `${PRODUCTS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(products, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
  fs.renameSync(tmp, PRODUCTS_FILE);
};

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const specs = [].concat(JSON.parse(fs.readFileSync(specFile, 'utf8')));
  const raw = fs.readFileSync(PRODUCTS_FILE, 'utf8');
  const products = JSON.parse(raw);
  if (!Array.isArray(products) || products.length < 1000) throw new Error('products.json ilegible o sospechosamente pequeño');
  const before = products.length;

  const ids = new Set(products.map(p => String(p.id)));
  const knownFp = new Map();
  for (const p of products) {
    const t = parseTitle(p.nameEn || '', { includeRetro: true, minSeasonStart: 1900 });
    const fp = t.verdict === 'include' ? fingerprint(t) : null;
    if (fp && !knownFp.has(fp)) knownFp.set(fp, p);
  }
  console.log(`Catálogo: ${before} productos · altas pedidas: ${specs.length}${DRY ? ' · DRY-RUN' : ''}\n`);

  const added = [];
  const failed = [];
  for (const spec of specs) {
    const label = spec.title || '(sin título)';
    try {
      const yp = spec.yupoo ? parseYupoo(spec.yupoo) : null;
      const id = String(spec.id || yp?.albumId || `mn${crypto.randomBytes(5).toString('hex')}`);
      if (ids.has(id)) throw new Error(`el id ${id} ya existe en el catálogo`);
      const yupooUrl = yp ? `${yp.shop}/albums/${yp.albumId}?uid=1` : '';
      const { p, t } = build(spec, id, yupooUrl);

      const fp = t.verdict === 'include' ? fingerprint(t) : null;
      const dup = fp && knownFp.get(fp);
      if (dup && !FORCE) throw new Error(`posible duplicado de ${dup.id} "${dup.nameEn}" (usa --force si son distintos)`);

      // Fotos: las indicadas a mano, o las del álbum de Yupoo
      const max = spec.photos || 4;
      let sources = (spec.images || []).slice(0, max);
      let total = sources.length;
      let referer;
      if (!sources.length && spec.yupoo) {
        const ph = await yupooPhotos(spec.yupoo, max);
        sources = ph.urls; total = ph.total; referer = `${ph.shop}/`;
      }
      if (!sources.length) throw new Error('sin fotos: indica "images" o "yupoo"');

      if (DRY) {
        console.log(`· ${id}  ${label}\n  ${JSON.stringify({ cats: p.cats, type: p.type, priceUsd: p.priceUsd, sizes: p.sizes, nameEs: p.nameEs })}\n  fotos: ${sources.length}${dup ? `  ⚠ huella igual a ${dup.id}` : ''}`);
      } else {
        const { uploadBuffer } = require('./images');
        const urls = [];
        for (let i = 0; i < sources.length; i++) urls.push((await uploadBuffer(id, i + 1, await loadImage(sources[i], referer))).url);
        p.img = urls[0];
        p.photos = total;
        if (urls.length > 1) p.gallery = urls.slice(1);
        console.log(`✓ ${id}  ${label}  (${urls.length} fotos) ${p.cats.join(',')} · ${p.priceUsd} USD · ${p.sizes.join(',')}`);
      }
      products.push(p);
      ids.add(id);
      if (fp) knownFp.set(fp, p);
      added.push(p);
    } catch (e) {
      failed.push({ title: label, error: e.message });
      console.log(`✗ ${label}: ${e.message}`);
    }
  }

  if (!DRY && added.length) writeProducts(products, raw);
  console.log(`\nAñadidos: ${added.length}${DRY ? ' (simulado)' : ''} · fallos: ${failed.length} · catálogo: ${before} → ${DRY ? before : products.length}`);
  if (failed.length) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
