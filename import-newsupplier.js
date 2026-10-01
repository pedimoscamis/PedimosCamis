/**
 * Construye las entradas de catálogo para los candidatos del nuevo proveedor
 * (data/newsupplier-candidates.json: newCurrentVariant + newRetro) y las
 * añade a data/products.json SIN imágenes todavía (img/gallery se rellenan
 * después con download-newsupplier-images.js). Reutiliza la misma lógica de
 * categorize.js (categorizeCats/detectSizes/getPrice) para que el resultado
 * sea indistinguible de un producto scrapeado normalmente.
 */
const fs = require('fs');
const path = require('path');

const PRODUCTS_FILE  = path.join(__dirname, 'data', 'products.json');
const CANDIDATES_FILE = path.join(__dirname, 'data', 'newsupplier-candidates.json');
const NEW_IDS_FILE    = path.join(__dirname, 'data', 'newsupplier-new-ids.json');

// ─── Copiado literal de categorize.js (misma lógica, no reinventar) ──────────
const RETRO_YEAR_RE  = /\b(19\d{2}|200[0-9]|201[0-9])\b/;
const SLASH_SEASON_RE = /\b(\d{2})\/(\d{2})\b/;
const MODERN_DECADE_RE = /\b(2[0-9])\/(2[0-9])\b/;
function isRetro(name) {
  const n = name.toLowerCase();
  if (n.includes('retro')) return true;
  if (RETRO_YEAR_RE.test(name)) return true;
  if (SLASH_SEASON_RE.test(name) && !MODERN_DECADE_RE.test(name)) return true;
  return false;
}
const SIZE_RANGES = [
  { re: /S[-–]4XL|S\s*-\s*4XL/i,      sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'] },
  { re: /S[-–]3XL|S\s*-\s*3XL/i,      sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'] },
  { re: /S[-–](XXL|2XL)|S\s*-\s*(XXL|2XL)/i, sizes: ['S', 'M', 'L', 'XL', '2XL'] },
  { re: /S[-–]XL|S\s*-\s*XL/i,        sizes: ['S', 'M', 'L', 'XL'] },
  { re: /16[-–：]28|size[：:]\s*16[-–]28/i, sizes: ['16', '18', '20', '22', '24', '26', '28'] },
  { re: /9[-–]12|size[：:]\s*9[-–]12/i,    sizes: ['9', '10', '11', '12'] },
];
const DEFAULT_SIZES = ['S', 'M', 'L', 'XL', '2XL'];
function detectSizes(name) {
  for (const { re, sizes } of SIZE_RANGES) if (re.test(name)) return sizes;
  return DEFAULT_SIZES;
}
const NEW_SEASON_RE = /26\/27|2026\/27|2026-27/;
const WOMEN_NAME_RE = /\bwomen\b|\bwomen's\b|\bwoman\b|\bfemenin|\bfemale\b|\bmujer\b/i;
const KIDS_NAME_RE  = /\bkid\b|\bkids\b|\bbaby\b|\byouth\b|\bchildren\b|9[-–]12|9–12/i;
function categorizeCatsForLeague(name, league) {
  const result = new Set();
  if (isRetro(name)) {
    result.add('retro');
    result.add(league);
  } else {
    result.add(league);
  }
  if (NEW_SEASON_RE.test(name)) result.add('nuevatemporada');
  if (WOMEN_NAME_RE.test(name)) result.add('women');
  if (KIDS_NAME_RE.test(name)) result.add('kids');
  return [...result];
}
function getPrice(cats, name) {
  if (cats.includes('retro') || name.toLowerCase().includes('retro')) return 13;
  return 8;
}

function main() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
  const existingIds = new Set(products.map(p => String(p.id)));
  const candidates = JSON.parse(fs.readFileSync(CANDIDATES_FILE, 'utf-8'));
  const all = [...candidates.newCurrentVariant, ...candidates.newRetro];

  const newEntries = [];
  for (const item of all) {
    const id = String(item.id);
    if (existingIds.has(id)) { console.warn('Colisión de id, omitido:', id); continue; }
    const cats = categorizeCatsForLeague(item.name, item.kitzoneCat);
    const sizes = detectSizes(item.name);
    const priceUsd = getPrice(cats, item.name);
    const type = cats.includes('retro') ? 'retro' : 'normal';
    newEntries.push({
      id,
      nameEs: item.name,
      nameEn: item.name,
      cats,
      type,
      priceUsd,
      yupooCategory: item.kitzoneCat,
      yupooUrl: item.yupooUrl,
      img: null,
      photos: 0,
      sizes,
      addedAt: Date.now(),
      supplier: 'newsupplier', // trazabilidad: viene del proveedor nuevo
    });
  }

  const merged = [...products, ...newEntries];
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(merged, null, 2));
  fs.writeFileSync(NEW_IDS_FILE, JSON.stringify(newEntries.map(e => e.id), null, 2));

  console.log(`Entradas nuevas añadidas: ${newEntries.length}`);
  console.log(`Total catálogo: ${merged.length}`);
  const byCat = {};
  for (const e of newEntries) for (const c of e.cats) byCat[c] = (byCat[c] || 0) + 1;
  console.log('Por categoría:', byCat);
}

main();
