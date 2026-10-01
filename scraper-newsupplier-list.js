/**
 * Fase 1 (solo listado) del nuevo proveedor — a15707508070.x.yupoo.com
 * Recorre las categorías de las 5 grandes ligas (hay dos árboles de
 * categorías en este proveedor: uno antiguo "club shirt" y uno nuevo
 * específico por liga; se combinan y deduplican) y guarda id+nombre+url,
 * SIN descargar imágenes todavía. Sirve para comparar contra nuestro
 * catálogo antes de decidir qué productos son realmente nuevos.
 */
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://a15707508070.x.yupoo.com';
const OUT_FILE = path.join(__dirname, 'data', 'newsupplier-raw.json');

const CATEGORIES = [
  { id: '4990842', kitzoneCat: 'laliga' },     // La Liga club shirt
  { id: '5067341', kitzoneCat: 'laliga' },     // La Liga (nueva)
  { id: '4990846', kitzoneCat: 'premier' },    // Premier League club shirt
  { id: '5067344', kitzoneCat: 'premier' },    // Premier League (nueva)
  { id: '4990845', kitzoneCat: 'seriea' },     // Serie A
  { id: '4990853', kitzoneCat: 'bundesliga' }, // Bundesliga club shirt
  { id: '5067345', kitzoneCat: 'bundesliga' }, // Bundesliga (nueva)
  { id: '4990849', kitzoneCat: 'ligue1' },     // Ligue 1
];

const DELAY = 700;
const MAX_EMPTY_PAGES = 2;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchPage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout: 15000,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      console.warn(`  [Intento ${attempt}/${retries}] Error en ${url}: ${err.message}`);
      if (attempt < retries) await sleep(2000 * attempt);
    }
  }
  return null;
}

function parseAlbumsFromHtml(html) {
  const $ = cheerio.load(html);
  const albums = [];
  const seen = new Set();
  function tryAdd(id, name, href) {
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
    albums.push({ id, name, yupooUrl: url });
  }
  $('a.album__main, a[href*="/albums/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/\/albums\/(\d+)/);
    if (!match) return;
    const name = (
      $(el).attr('title') ||
      $(el).find('img').attr('alt') ||
      $(el).find('[class*="title"],[class*="name"]').first().text()
    ).trim();
    tryAdd(match[1], name, href);
  });
  return albums;
}

async function fetchCategoryPage(categoryId, page) {
  const url = `${BASE_URL}/categories/${categoryId}?page=${page}`;
  const html = await fetchPage(url);
  if (!html) return [];
  return parseAlbumsFromHtml(html);
}

async function main() {
  console.log('=== Scraper listado — nuevo proveedor ===');
  const existing = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf-8')) : [];
  const byId = new Map(existing.map(p => [p.id, p]));

  for (const cat of CATEGORIES) {
    console.log(`\n📂 categoría ${cat.id} (${cat.kitzoneCat})`);
    let page = 1, emptyStreak = 0, total = 0;
    while (emptyStreak < MAX_EMPTY_PAGES) {
      process.stdout.write(`  página ${page}... `);
      const albums = await fetchCategoryPage(cat.id, page);
      if (albums.length === 0) {
        emptyStreak++;
        console.log(`vacía (${emptyStreak}/${MAX_EMPTY_PAGES})`);
      } else {
        emptyStreak = 0;
        total += albums.length;
        for (const a of albums) {
          if (!byId.has(a.id)) {
            byId.set(a.id, { ...a, kitzoneCat: cat.kitzoneCat, sourceCategoryIds: [cat.id] });
          } else {
            const existingEntry = byId.get(a.id);
            if (!existingEntry.sourceCategoryIds.includes(cat.id)) existingEntry.sourceCategoryIds.push(cat.id);
          }
        }
        console.log(`${albums.length} álbumes (${total} acum. en esta categoría)`);
      }
      page++;
      await sleep(DELAY);
      // checkpoint
      if (page % 10 === 0) {
        fs.writeFileSync(OUT_FILE, JSON.stringify([...byId.values()], null, 2));
      }
    }
    console.log(`  ✓ categoría ${cat.id}: ${total} álbumes`);
  }

  const all = [...byId.values()];
  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 2));
  console.log(`\n=== Listado completado: ${all.length} álbumes únicos ===`);
}

main().catch(err => { console.error('Error fatal:', err); process.exit(1); });
