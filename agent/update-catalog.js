#!/usr/bin/env node
'use strict';
/**
 * Agente de actualización del catálogo (ggjersey.x.yupoo.com → products.json).
 *
 * Cada ejecución:
 *   1. Recorre "New arrivals" de más nuevo a más viejo hasta llegar a lo ya visto.
 *   2. Clasifica cada título (agent/parse.js). Solo entran 5 grandes ligas,
 *      selecciones y la lista corta de clubes europeos (agent/teams.js).
 *      Lo dudoso NO entra: va al informe como `review`.
 *   3. Descarta duplicados (mismo id, o mismo equipo+temporada+atributos).
 *   4. Por producto nuevo: portada + 3 siguientes fotos → WebP → R2.
 *   5. Añade al final de data/products.json (nunca modifica lo existente).
 *
 * Uso:
 *   node agent/update-catalog.js --dry-run           (clasifica y cuenta; no descarga ni escribe)
 *   node agent/update-catalog.js                     (ejecución real)
 *   Opciones: --max-pages N (80) --max-new N (800) --since-id ID --collection URL
 * --limit N (procesa como mucho N productos nuevos)
 */
const fs = require('fs');
const path = require('path');
const { parseTitle, buildProduct, fingerprint } = require('./parse');
const { SHOP, sleep, listPage, albumPhotos } = require('./yupoo');

const ROOT = path.join(__dirname, '..');
const PRODUCTS_FILE = path.join(ROOT, 'data', 'products.json');
const STATE_FILE = path.join(ROOT, 'data', 'catalog-agent-state.json');
const REPORT_FILE = path.join(ROOT, 'data', 'catalog-agent-report.json');

// ─── Configuración ───────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

const CFG = {
  dryRun: flag('dry-run'),
  collection: opt('collection', `${SHOP}/collections/5179824?isSubCate=false`),
  maxPages: +opt('max-pages', 80),
  maxNew: +opt('max-new', 800),
  limit: +opt('limit', Infinity),
  sinceId: opt('since-id', null),
  includeRetro: true,                     // el retro entra siempre
  minSeasonStart: 0,                      // todas las temporadas
  photos: 4,                              // portada + 3 siguientes
  prices: { normal: 8, retro: 13 },       // convención del catálogo (categorize.js::getPrice)
  quietPagesToStop: 2,                    // páginas seguidas sin nada nuevo para parar
  maxAttempts: 3,                         // reintentos de un álbum cuyas fotos fallan
};

const log = (...a) => console.log(...a);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const started = new Date();
  const products = readJson(PRODUCTS_FILE, null);
  if (!Array.isArray(products) || products.length < 1000) {
    throw new Error('products.json ilegible o sospechosamente pequeño — abortando sin tocar nada');
  }

  const existingIds = new Set(products.map(p => String(p.id)));
  const knownFp = new Set();
  for (const p of products) {
    const t = parseTitle(p.nameEn || '', { includeRetro: true, minSeasonStart: 1900 });
    const fp = t.verdict === 'include' ? fingerprint(t) : null;
    if (fp) knownFp.add(fp);
  }

  const state = readJson(STATE_FILE, {});
  const ggIds = products.filter(p => /ggjersey/.test(p.yupooUrl || '')).map(p => +p.id).filter(Number.isFinite);
  const baseline = CFG.sinceId ? +CFG.sinceId : (state.lastMaxId ?? Math.max(...ggIds));
  const retry = state.retry || {};     // { albumId: { title, attempts } }
  log(`Catálogo: ${products.length} productos · último álbum conocido: ${baseline} · reintentos pendientes: ${Object.keys(retry).length}`);
  if (CFG.dryRun) log('MODO DRY-RUN: no se descarga nada ni se escribe nada.\n');

  // ── 1) Recorrido del listado ───────────────────────────────────────────────
  const candidates = [];        // álbumes a evaluar (id > baseline, o en reintento)
  let newMax = baseline, quiet = 0, pagesRead = 0, crawlOk = true;
  const seenInRun = new Set();

  for (let page = 1; page <= CFG.maxPages; page++) {
    let res;
    try { res = await listPage(CFG.collection, page); }
    catch (e) { log(`✗ Página ${page}: ${e.message}`); crawlOk = false; break; }
    pagesRead++;
    if (!res.albums.length) { log(`Página ${page} vacía — fin.`); break; }

    let fresh = 0;
    for (const a of res.albums) {
      const idn = +a.id;
      if (seenInRun.has(a.id)) continue;
      seenInRun.add(a.id);
      newMax = Math.max(newMax, idn);
      if (idn > baseline || retry[a.id]) { candidates.push(a); fresh++; }
    }
    log(`Página ${page}/${res.totalPages ?? '?'}: ${res.albums.length} álbumes, ${fresh} nuevos`);
    quiet = fresh === 0 ? quiet + 1 : 0;
    if (quiet >= CFG.quietPagesToStop) break;
    if (res.totalPages && page >= res.totalPages) break;
    await sleep(600);
  }
  if (pagesRead >= CFG.maxPages && quiet < CFG.quietPagesToStop) {
    log(`⚠ Se alcanzó --max-pages (${CFG.maxPages}) sin llegar a lo ya visto; el siguiente run continuará.`);
    crawlOk = false;   // no avanzar el marcador: faltan álbumes por mirar
  }

  // ── 2) Clasificación ───────────────────────────────────────────────────────
  const tally = { include: 0, skip: 0, review: 0, duplicate: 0 };
  const skipReasons = {};
  const review = [];
  const toAdd = [];
  for (const a of candidates) {
    const t = parseTitle(a.title, CFG);
    if (t.verdict === 'skip') {
      tally.skip++;
      const k = t.reason.replace(/\(.*/, '');
      skipReasons[k] = (skipReasons[k] || 0) + 1;
      continue;
    }
    if (t.verdict === 'review') { tally.review++; review.push({ id: a.id, title: a.title, reason: t.reason, residual: t.residual }); continue; }
    if (existingIds.has(a.id)) { tally.duplicate++; continue; }
    const fp = fingerprint(t);
    if (!fp) { tally.review++; review.push({ id: a.id, title: a.title, reason: 'sin-huella' }); continue; }
    if (knownFp.has(fp)) { tally.duplicate++; continue; }
    knownFp.add(fp);
    tally.include++;
    toAdd.push({ album: a, t, fp });
  }
  log(`\nClasificación de ${candidates.length} álbumes: ${tally.include} nuevos · ${tally.duplicate} duplicados · ${tally.skip} fuera de alcance · ${tally.review} a revisar`);
  log('Fuera de alcance por motivo:', skipReasons);

  if (toAdd.length > CFG.maxNew) {
    throw new Error(`${toAdd.length} productos nuevos superan --max-new (${CFG.maxNew}). Parece un fallo del clasificador o un backlog enorme: revisa con --dry-run y sube --max-new si es correcto.`);
  }
  const work = toAdd.slice(0, CFG.limit);

  // ── 3) Imágenes + alta ─────────────────────────────────────────────────────
  const added = [];
  const failed = [];
  if (!CFG.dryRun) {
    const { uploadAlbum } = require('./images');
    let n = 0;
    for (const { album, t } of work) {
      n++;
      process.stdout.write(`[${n}/${work.length}] ${album.id} ${album.title.slice(0, 70)} … `);
      try {
        const ph = await albumPhotos(album.id, CFG.photos, album.coverId);
        if (!ph.urls.length) throw new Error('álbum sin fotos');
        const { img, gallery } = await uploadAlbum(album.id, ph.urls);
        const p = buildProduct(t, { id: album.id, yupooUrl: `${SHOP}/albums/${album.id}?uid=1`, prices: CFG.prices });
        p.img = img;
        p.photos = ph.total;
        if (gallery.length) p.gallery = gallery;
        products.push(p);
        existingIds.add(p.id);
        added.push({ id: p.id, title: p.nameEn, cats: p.cats, priceUsd: p.priceUsd, sizes: p.sizes.join(','), images: 1 + gallery.length });
        delete retry[album.id];
        log(`ok (${1 + gallery.length} fotos)`);
      } catch (e) {
        const attempts = (retry[album.id]?.attempts || 0) + 1;
        failed.push({ id: album.id, title: album.title, error: e.message, attempts });
        if (attempts < CFG.maxAttempts) retry[album.id] = { title: album.title, attempts };
        else { delete retry[album.id]; log(`  (descartado tras ${attempts} intentos)`); }
        log(`FALLO: ${e.message}`);
      }
      await sleep(500);
    }
  } else {
    for (const { album, t } of work) {
      const p = buildProduct(t, { id: album.id, yupooUrl: `${SHOP}/albums/${album.id}?uid=1`, prices: CFG.prices });
      added.push({ id: p.id, title: p.nameEn, cats: p.cats, priceUsd: p.priceUsd, sizes: p.sizes.join(','), type: p.type });
    }
  }

  // ── 4) Guardado ────────────────────────────────────────────────────────────
  const unknown = {};
  for (const r of review) if (r.reason === 'equipo-desconocido') { const k = (r.residual || []).join(' ') || r.title; unknown[k] = (unknown[k] || 0) + 1; }
  const report = {
    runAt: started.toISOString(),
    dryRun: CFG.dryRun,
    pagesRead, candidates: candidates.length, tally, skipReasons,
    added: added.length, failed, retryPending: Object.keys(retry).length,
    addedItems: added,
    review: review.filter(r => r.reason !== 'equipo-desconocido').slice(0, 80),
    unknownTeams: Object.entries(unknown).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([team, count]) => ({ team, count })),
  };

  if (!CFG.dryRun) {
    if (added.length) writeJsonAtomic(PRODUCTS_FILE, products);
    writeJsonAtomic(STATE_FILE, {
      lastMaxId: crawlOk && work.length === toAdd.length ? newMax : baseline,
      lastRun: started.toISOString(),
      retry,
    });
    writeJsonAtomic(REPORT_FILE, report);
  }

  log(`\n══ Resumen ══════════════════════════════════════════`);
  log(`Añadidos: ${added.length}${CFG.dryRun ? ' (simulado)' : ''} · fallos de imagen: ${failed.length} · pendientes de reintento: ${Object.keys(retry).length}`);
  log(`A revisar: ${review.length} (equipos desconocidos: ${Object.values(unknown).reduce((a, b) => a + b, 0)})`);
  if (CFG.dryRun) {
    const byCat = {};
    for (const a of added) for (const c of a.cats) byCat[c] = (byCat[c] || 0) + 1;
    log('Por categoría:', byCat);
    fs.writeFileSync(opt('report', path.join(require('os').tmpdir(), 'catalog-agent-dryrun.json')), JSON.stringify(report, null, 2));
  }
  if (failed.length && !added.length && work.length) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
