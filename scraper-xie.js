'use strict';
/**
 * scraper-xie.js — Scraper del nuevo proveedor jerseyxie.x.yupoo.com
 *
 * Fases:
 *  1. Descubre categorías desde /categories (auto-descubrimiento de IDs)
 *  2. Por cada categoría pagina álbumes hasta vacío
 *  3. Por cada álbum nuevo extrae imagen (small.jpg)
 *  4. Matching fuzzy contra products.json existente:
 *       mismo equipo + temporada + tipo de vestimenta → mismo artículo
 *  5. Añade los productos genuinamente nuevos a products.json
 *  6. Marca avisoStock:true en los existentes que ya no aparecen en Xie
 *  7. Guarda products.json actualizado (SIN tocar nada más de los existentes)
 *
 * Uso:
 *   node scraper-xie.js                → proceso completo
 *   node scraper-xie.js --dry-run      → sin guardar; muestra qué haría
 *   node scraper-xie.js --limit 50     → solo los primeros 50 álbumes nuevos
 *   node scraper-xie.js --no-aviso     → no marca avisoStock (solo añade nuevos)
 */

const fetch   = require('node-fetch');
const cheerio = require('cheerio');
const fs      = require('fs');
const path    = require('path');

// ─── Configuración ────────────────────────────────────────────────────────────

const BASE_URL      = 'https://jerseyxie.x.yupoo.com';
const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');

const DELAY_LISTING  = 1000;  // ms entre páginas de listado
const DELAY_ALBUM    = 700;   // ms entre visitas a álbumes individuales
const MAX_EMPTY_PAGES = 2;    // páginas vacías consecutivas para parar
const MATCH_THRESHOLD = 0.40; // umbral Jaccard mínimo para considerar mismo artículo

// Tallas por defecto (el proveedor no las especifica en el nombre)
const DEFAULT_SIZES = ['S', 'M', 'L', 'XL', '2XL'];

// Detecta rangos de tallas explícitos en el nombre (por si acaso los pone)
const SIZE_RANGES = [
  { re: /S[-–]\s*4XL/i, sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'] },
  { re: /S[-–]\s*3XL/i, sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'] },
  { re: /S[-–]\s*(?:XXL|2XL)/i, sizes: ['S', 'M', 'L', 'XL', '2XL'] },
  { re: /S[-–]\s*XL/i,  sizes: ['S', 'M', 'L', 'XL'] },
];
function detectSizes(name) {
  for (const { re, sizes } of SIZE_RANGES) {
    if (re.test(name)) return sizes;
  }
  return DEFAULT_SIZES;
}

// ─── Mapeo nombre-categoría → kitzoneCat ─────────────────────────────────────
//
// Se aplica sobre el nombre de la categoría descubierta en /categories.
// Las keywords son en minúsculas; se comparan contra el nombre de categoría en minúsculas.

const CAT_MAP = [
  { kitzoneCat: 'laliga',      keys: ['laliga', 'la liga', 'spanish', 'spain league', 'primera'] },
  { kitzoneCat: 'premier',     keys: ['premier', 'english', 'scotland', 'scottish'] },
  { kitzoneCat: 'seriea',      keys: ['serie a', 'seriea', 'italian', 'italy league'] },
  { kitzoneCat: 'bundesliga',  keys: ['bundesliga', 'german', 'germany league'] },
  { kitzoneCat: 'ligue1',      keys: ['ligue', 'french', 'france league'] },
  { kitzoneCat: 'selecciones', keys: ['national', 'selecciones', 'international', 'world cup', 'nations'] },
  { kitzoneCat: 'sudamerica',  keys: ['brazil', 'brasil', 'argentina', 'south america', 'sudamerica', 'mls', 'mexican', 'mexico', 'liga mx', 'colombia', 'chile', 'peru', 'uruguay', 'concacaf'] },
  { kitzoneCat: 'europa',      keys: ['dutch', 'eredivisie', 'portuguese', 'portugal league', 'turkish', 'greek', 'belgian', 'austrian', 'swiss', 'russian', 'ukrainian', 'czech', 'polish', 'romanian', 'danish', 'swedish', 'norwegian', 'finnish', 'european'] },
  { kitzoneCat: 'retro',       keys: ['retro', 'classic', 'vintage', 'throwback'] },
  { kitzoneCat: 'nba',         keys: ['nba', 'basketball'] },
  { kitzoneCat: 'nfl',         keys: ['nfl', 'american football'] },
  { kitzoneCat: 'streetwear',  keys: ['streetwear', 'street wear', 'fashion', 'gallery dept', 'bape', 'amiri'] },
  { kitzoneCat: 'windbreaker', keys: ['windbreaker', 'jacket', 'wind'] },
  { kitzoneCat: 'kids',        keys: ['kids', 'children', 'youth', 'junior', 'baby'] },
  { kitzoneCat: 'women',       keys: ['women', 'woman', 'female', 'ladies'] },
];

function catNameToKitzone(categoryName) {
  const lower = categoryName.toLowerCase();
  for (const { kitzoneCat, keys } of CAT_MAP) {
    if (keys.some(k => lower.includes(k))) return kitzoneCat;
  }
  return 'otros';
}

// ─── Categorizador inline (portado de categorize.js) ─────────────────────────

const CATEGORY_RULES = [
  { cat: 'laliga',      keywords: ['real madrid', 'barcelona', 'atletico madrid', 'atletico de madrid', 'betis', 'sevilla', 'bilbao', 'athletic bilbao', 'valencia', 'villarreal', 'celta', 'osasuna', 'espanyol', 'malaga', 'zaragoza', 'valladolid', 'oviedo', 'real sociedad', 'sociedad', 'girona', 'cadiz'] },
  { cat: 'premier',     keywords: ['manchester city', 'arsenal', 'liverpool', 'chelsea', 'manchester united', 'man united', 'man city', 'tottenham', 'spurs', 'newcastle', 'west ham', 'wolves', 'wolverhampton', 'leicester', 'fulham', 'aston villa', 'leeds', 'everton', 'brighton', 'crystal palace', 'bournemouth', 'nottingham', 'celtic', 'rangers', 'sunderland'] },
  { cat: 'seriea',      keywords: ['inter milan', 'inter', 'ac milan', 'napoli', 'roma', 'lazio', 'juventus', 'atalanta', 'fiorentina', 'venezia', 'parma'] },
  { cat: 'bundesliga',  keywords: ['bayern', 'dortmund', 'bvb', 'leverkusen', 'leipzig', 'rb leipzig', 'frankfurt', 'eintracht', 'schalke', 'hamburg', 'hamburger', 'werder', 'bremen', 'union berlin', 'koln', 'augsburg', 'hoffenheim', 'freiburg', 'mainz'] },
  { cat: 'ligue1',      keywords: ['psg', 'paris saint', 'marseille', 'lyon', 'lens', 'monaco', 'rennes', 'rennais', 'metz', 'strasbourg'] },
  { cat: 'selecciones', keywords: ['france', 'england', 'brasil', 'brazil', 'netherlands', 'holland', 'germany', 'deutschland', 'portugal', 'spain', 'argentina', 'japan', 'italy', 'italia', 'usa', 'united states', 'belgium', 'mexico', 'scotland', 'korea', 'south korea', 'uruguay', 'wales', 'ireland', 'colombia', 'croatia', 'chile', 'norway', 'turkey', 'jamaica', 'morocco', 'ukraine', 'australia', 'paraguay', 'ecuador', 'peru', 'greece', 'albania', 'hungary', 'canada', 'sweden', 'senegal', 'nigeria', 'congo'] },
  { cat: 'europa',      keywords: ['porto', 'benfica', 'sporting cp', 'sporting lisbon', 'ajax', 'psv', 'anderlecht', 'bruges', 'club brugge', 'galatasaray', 'besiktas', 'fenerbahce', 'olympiacos', 'red star'] },
  { cat: 'sudamerica',  keywords: ['flamengo', 'palmeiras', 'corinthians', 'sao paulo', 'fluminense', 'atletico mineiro', 'botafogo', 'vasco', 'santos', 'cruzeiro', 'gremio', 'internacional', 'river plate', 'boca juniors', 'boca', 'racing club', 'independiente', 'san lorenzo', 'colo colo', 'club america', 'chivas', 'guadalajara', 'cruz azul', 'monterrey', 'atletico nacional', 'millonarios', 'penarol', 'new york city', 'nycfc', 'los angeles fc', 'lafc', 'vancouver'] },
  { cat: 'nba',         keywords: ['nba', 'lakers', 'bulls', 'warriors', 'celtics', 'heat', 'knicks', 'bucks', 'nets', 'suns', 'nuggets', 'mavericks', '76ers', 'sixers', 'cavaliers', 'grizzlies', 'raptors', 'spurs', 'thunder', 'blazers', 'magic', 'wizards', 'pelicans', 'jazz', 'kings', 'pistons', 'hawks', 'hornets', 'pacers', 'rockets', 'clippers', 'mitchellness'] },
  { cat: 'nfl',         keywords: ['nfl'] },
  { cat: 'streetwear',  keywords: ['gallery dept', 'bape', 'amiri', 'palm angels', 'chrome hearts', 'off white', 'off-white', 'hellstar', 'trapstar', 'sp5der', 'vlone', 'rhude', 'fear of god', 'corteiz', 'purple brand', 'casablanca', 'ami paris'] },
  { cat: 'windbreaker', keywords: ['windbreaker', 'wind breaker'] },
  { cat: 'kids',        keywords: ['kid', 'baby', 'kids kit', 'youth', 'children'] },
  { cat: 'women',       keywords: ['women', 'woman', 'female', 'ladies'] },
];

const OVERLAY_CATS    = new Set(['retro', 'nuevatemporada', 'women', 'kids']);
const RETRO_YEAR_RE   = /\b(19\d{2}|200[0-9]|201[0-9])\b/;
const SLASH_SEASON_RE = /\b(\d{2})\/(\d{2})\b/;
const MODERN_RE       = /\b(2[0-9])\/(2[0-9])\b/;
const NEW_SEASON_RE   = /26\/27|2026\/27|2026-27/;
const WOMEN_NAME_RE   = /\bwomen\b|\bwomen's\b|\bwoman\b|\bfemale\b|\bmujer\b/i;
const KIDS_NAME_RE    = /\bkid\b|\bkids\b|\bbaby\b|\byouth\b|\bchildren\b/i;
const PLAYER_RE       = /\bplayer\s*version\b|\bplayer\s*edition\b/i;

function isRetro(name) {
  const n = name.toLowerCase();
  if (n.includes('retro')) return true;
  if (RETRO_YEAR_RE.test(name)) return true;
  if (SLASH_SEASON_RE.test(name) && !MODERN_RE.test(name)) return true;
  return false;
}

function categorizeCats(name, yupooCategory) {
  const lower   = name.toLowerCase();
  const result  = new Set();
  const VALID   = new Set(['laliga','premier','seriea','bundesliga','ligue1','selecciones','sudamerica','europa','retro','nba','nfl','streetwear','windbreaker','kids','women','nuevatemporada']);

  let leagueCat = (yupooCategory && VALID.has(yupooCategory) && !OVERLAY_CATS.has(yupooCategory))
    ? yupooCategory : null;

  if (!leagueCat) {
    for (const { cat, keywords } of CATEGORY_RULES) {
      if (OVERLAY_CATS.has(cat)) continue;
      for (const kw of keywords) {
        if (lower.includes(kw)) { leagueCat = cat; break; }
      }
      if (leagueCat) break;
    }
  }
  if (!leagueCat) leagueCat = 'otros';

  if (isRetro(name)) {
    result.add('retro');
    if (leagueCat !== 'otros') result.add(leagueCat);
  } else {
    result.add(leagueCat);
  }

  if (NEW_SEASON_RE.test(name))         result.add('nuevatemporada');
  if (WOMEN_NAME_RE.test(name) || yupooCategory === 'women') result.add('women');
  if (KIDS_NAME_RE.test(name)  || yupooCategory === 'kids')  result.add('kids');

  return [...result];
}

function getPrice(cats, name) {
  if (cats.includes('retro') || name.toLowerCase().includes('retro')) return 13;
  if (PLAYER_RE.test(name)) return 18;
  return 15;
}

// ─── Matching fuzzy ───────────────────────────────────────────────────────────

const MATCH_STOPS = new Set([
  'jersey', 'shirt', 'kit', 'top', 'version', 'edition', 'special',
  'world', 'cup', 'mundial', 'retro', 'goalkeeper', 'portero',
  'local', 'visitante', 'tercera', 'cuarta', 'kids', 'youth',
  'children', 'women', 'woman', 'female', 'fc', 'cf', 'afc', 'sc',
  'the', 'and', 'de', 'del', 'la', 'el', 'player', 'fan', 'an', 'in', 'of',
  'home', 'away', 'third', 'fourth', '3rd', '4th',
]);

function normSeason(s) {
  // "2024-25" / "24/25" / "2024/25" → "2425"
  s = s.replace(/\b(20)?(\d{2})\s*[-\/–]\s*(\d{2})\b/g, (_, p, y1, y2) => y1 + y2);
  // Single 4-digit year: 2026 → "26"
  s = s.replace(/\b(2024|2025|2026|2027|2028)\b/g, y => y.slice(2));
  return s;
}

function extractKitType(name) {
  const n = name.toLowerCase();
  if (/\b(home|local)\b/.test(n))             return 'home';
  if (/\b(away|visitante)\b/.test(n))          return 'away';
  if (/\b(third|3rd|tercera)\b/.test(n))       return 'third';
  if (/\b(fourth|4th|cuarta)\b/.test(n))       return 'fourth';
  if (/\b(goalkeeper|portero|gk)\b/.test(n))   return 'gk';
  return 'other';
}

function extractKitInfo(name) {
  let s = normSeason(name.toLowerCase());
  s = s.replace(/s\s*[-–]\s*\d*(xxl|4xl|3xl|xl)/gi, ''); // quitar rangos talla
  s = s.replace(/[^\w\s]/g, ' ');

  const tokens      = s.split(/\s+/).filter(t => t.length > 1 && !MATCH_STOPS.has(t));
  const seasonToks  = new Set(tokens.filter(t => /^\d{2,4}$/.test(t)));
  const teamToks    = new Set(tokens.filter(t => isNaN(t) && t.length > 1));
  const kitType     = extractKitType(name);
  return { kitType, teamToks, seasonToks };
}

function matchScore(nameA, nameB) {
  const a = extractKitInfo(nameA);
  const b = extractKitInfo(nameB);

  // Tipos incompatibles → no es el mismo
  if (a.kitType !== 'other' && b.kitType !== 'other' && a.kitType !== b.kitType) return 0;

  // Jaccard sobre tokens de equipo
  const teamUnion  = new Set([...a.teamToks, ...b.teamToks]);
  const teamCommon = [...a.teamToks].filter(t => b.teamToks.has(t)).length;
  const teamJ      = teamUnion.size ? teamCommon / teamUnion.size : 0;
  if (teamJ < 0.25) return 0; // equipos demasiado distintos

  // Jaccard sobre tokens de temporada
  const seasonUnion  = new Set([...a.seasonToks, ...b.seasonToks]);
  const seasonCommon = [...a.seasonToks].filter(t => b.seasonToks.has(t)).length;
  const seasonJ      = seasonUnion.size ? seasonCommon / seasonUnion.size : 0;

  return teamJ * 0.65 + seasonJ * 0.35;
}

function isMatch(nameA, nameB) {
  return matchScore(nameA, nameB) >= MATCH_THRESHOLD;
}

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const NO_AVISO = args.includes('--no-aviso');
const limitIdx = args.indexOf('--limit');
const LIMIT   = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

// ─── Helpers de red ───────────────────────────────────────────────────────────

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
      console.warn(`  [Intento ${attempt}/${retries}] ${url}: ${err.message}`);
      if (attempt < retries) await sleep(2000 * attempt);
    }
  }
  return null;
}

// ─── Fase 1: Descubrir categorías desde /categories ───────────────────────────

async function discoverCategories() {
  console.log(`\n── Fase 1: Descubriendo categorías en ${BASE_URL}/categories ──`);
  const html = await fetchPage(`${BASE_URL}/categories`);
  if (!html) { console.error('No se pudo cargar /categories'); return []; }

  const $    = cheerio.load(html);
  const cats = [];
  const seen = new Set();

  // Selector principal de categorías en Yupoo
  $('a[href*="/categories/"]').each((_, el) => {
    const href  = $(el).attr('href') || '';
    const match = href.match(/\/categories\/(\d+)/);
    if (!match) return;
    const id   = match[1];
    if (seen.has(id)) return;
    seen.add(id);

    const name = ($(el).attr('title') || $(el).text()).trim();
    if (!name) return;

    const kitzoneCat = catNameToKitzone(name);
    cats.push({ id, label: name, kitzoneCat });
    console.log(`  Encontrada: "${name}" (ID: ${id}) → ${kitzoneCat}`);
  });

  if (cats.length === 0) {
    console.warn('  ⚠️  No se encontraron categorías. Revisa el HTML de /categories.');
  }

  return cats;
}

// ─── Fase 2: Listar álbumes de una categoría ──────────────────────────────────

function parseAlbums(html) {
  const $      = cheerio.load(html);
  const albums = [];
  const seen   = new Set();

  function tryAdd(id, name, href) {
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
    albums.push({ id, name: name.trim(), yupooUrl: url });
  }

  $('a.album__main, a[href*="/albums/"]').each((_, el) => {
    const href  = $(el).attr('href') || '';
    const match = href.match(/\/albums\/(\d+)/);
    if (!match) return;
    const name  = ($(el).attr('title') || $(el).find('img').attr('alt') || $(el).find('[class*="title"],[class*="name"]').first().text()).trim();
    tryAdd(match[1], name, href);
  });

  if (albums.length === 0) {
    $('[class*="album"]').each((_, el) => {
      const link  = $(el).find('a[href*="/albums/"]').first();
      const href  = link.attr('href') || '';
      const match = href.match(/\/albums\/(\d+)/);
      if (!match) return;
      const name  = ($(el).find('[class*="title"],[class*="name"]').first().text() || link.attr('title') || '').trim();
      tryAdd(match[1], name, href);
    });
  }

  return albums;
}

async function listCategoryAlbums(catId) {
  const allAlbums = [];
  let page = 1, emptyStreak = 0;

  while (emptyStreak < MAX_EMPTY_PAGES) {
    process.stdout.write(`    pág ${page}... `);
    const html = await fetchPage(`${BASE_URL}/categories/${catId}?page=${page}`);
    if (!html) { emptyStreak++; console.log('error'); } else {
      const albums = parseAlbums(html);
      if (albums.length === 0) {
        emptyStreak++;
        console.log(`vacía (${emptyStreak}/${MAX_EMPTY_PAGES})`);
      } else {
        emptyStreak = 0;
        allAlbums.push(...albums);
        console.log(`${albums.length} álbumes`);
      }
    }
    page++;
    await sleep(DELAY_LISTING);
  }

  return allAlbums;
}

// ─── Fase 3: Extraer imagen de un álbum ───────────────────────────────────────

async function fetchAlbumImage(albumUrl) {
  const html = await fetchPage(albumUrl);
  if (!html) return { img: null, photos: 0 };

  const $      = cheerio.load(html);
  let imgUrl   = null;
  const allImgs = $('img[src*="photo.yupoo.com"], img[src*="img.yupoo.com"], img[data-src*="photo.yupoo.com"], img[data-src*="img.yupoo.com"]');
  const photos  = allImgs.length;
  const first   = allImgs.first();
  imgUrl        = first.attr('src') || first.attr('data-src') || null;

  if (!imgUrl) {
    $('img').each((_, el) => {
      if (imgUrl) return;
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (src.includes('photo.yupoo.com') || src.includes('img.yupoo.com')) imgUrl = src;
    });
  }

  if (imgUrl) {
    imgUrl = imgUrl.split('?')[0]
      .replace(/\/(small|medium|large|huge|square|thumb)\.(jpg|jpeg|png|webp)$/i, '/small.jpg');
  }

  return { img: imgUrl, photos };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  PedimosCamis? — Scraper Xie (nuevo proveedor) v1.0     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  if (DRY_RUN)   console.log('⚠️  DRY RUN — no se guardará nada');
  if (NO_AVISO)  console.log('ℹ️  --no-aviso: no se marcará avisoStock');
  if (isFinite(LIMIT)) console.log(`ℹ️  --limit ${LIMIT}: máximo ${LIMIT} álbumes nuevos`);

  // Cargar catálogo existente
  let existing = [];
  if (fs.existsSync(PRODUCTS_FILE)) {
    existing = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
  }
  console.log(`\nProductos existentes en catálogo: ${existing.length}`);

  // IDs ya conocidos (para no re-añadir el mismo álbum de Xie si se corre 2 veces)
  const existingXieIds = new Set(
    existing.filter(p => p.provider === 'xie').map(p => p.id)
  );

  // ── Fase 1: Descubrir categorías ──────────────────────────────────────────
  const categories = await discoverCategories();
  if (categories.length === 0) {
    console.error('\n❌ No se encontraron categorías. Abortando.');
    process.exit(1);
  }

  // ── Fase 2: Listar álbumes de cada categoría ──────────────────────────────
  console.log('\n── Fase 2: Listado de álbumes por categoría ──────────────────');

  const seenAlbumIds = new Set();
  let allNewAlbums   = [];  // álbumes de Xie con id/name/yupooUrl/kitzoneCat

  // También recopilamos TODOS los álbumes (incluso los que ya existen) para
  // poder cruzar contra el catálogo al final (para avisoStock).
  const allXieAlbums = [];

  for (const cat of categories) {
    console.log(`\n  📂 ${cat.label} (ID: ${cat.id}) → ${cat.kitzoneCat}`);
    const albums = await listCategoryAlbums(cat.id);

    for (const album of albums) {
      // Deduplicar (un álbum puede estar en varias categorías)
      if (seenAlbumIds.has(album.id)) continue;
      seenAlbumIds.add(album.id);

      allXieAlbums.push({ ...album, kitzoneCat: cat.kitzoneCat });

      // Solo es "nuevo" si no lo habíamos importado ya de Xie
      if (!existingXieIds.has(album.id)) {
        allNewAlbums.push({ ...album, kitzoneCat: cat.kitzoneCat });
      }
    }
    console.log(`  ✓ ${cat.label}: ${albums.length} álbumes`);
  }

  console.log(`\nTotal álbumes Xie únicos: ${allXieAlbums.length}`);
  console.log(`Álbumes nuevos (no importados aún): ${allNewAlbums.length}`);

  // Aplicar LIMIT
  if (isFinite(LIMIT)) allNewAlbums = allNewAlbums.slice(0, LIMIT);

  // ── Fase 3: Matching contra catálogo existente ────────────────────────────
  //
  // Para cada álbum nuevo de Xie, intentamos encontrar un producto equivalente
  // en el catálogo actual (mismo equipo + temporada + tipo vestimenta).
  // Si lo hay → el álbum ya existe con otro proveedor, no añadir.
  // Si no lo hay → producto genuinamente nuevo, añadir.

  console.log('\n── Fase 3: Matching contra catálogo existente ────────────────');

  const genuinelyNew = [];    // álbumes a añadir como nuevos productos
  let matchedCount   = 0;

  for (const album of allNewAlbums) {
    let bestScore = 0;
    let bestMatch = null;

    for (const ep of existing) {
      const name = ep.nameEn || ep.nameEs || '';
      const score = matchScore(album.name, name);
      if (score > bestScore) { bestScore = score; bestMatch = ep; }
    }

    if (bestScore >= MATCH_THRESHOLD) {
      matchedCount++;
      // No log en producción para no saturar; solo si --dry-run
      if (DRY_RUN) {
        console.log(`  ✓ MATCH (${bestScore.toFixed(2)}): "${album.name.substring(0,50)}"\n       ← "${(bestMatch.nameEn||'').substring(0,50)}"`);
      }
    } else {
      genuinelyNew.push(album);
      if (DRY_RUN) {
        console.log(`  + NUEVO: "${album.name.substring(0,70)}"`);
      }
    }
  }

  console.log(`  Coincidencias con catálogo existente: ${matchedCount}`);
  console.log(`  Genuinamente nuevos a incorporar:    ${genuinelyNew.length}`);

  // ── Fase 4: Extraer imágenes de los genuinamente nuevos ──────────────────
  console.log('\n── Fase 4: Extrayendo imágenes de los nuevos ─────────────────');

  const newProducts = [];

  for (let i = 0; i < genuinelyNew.length; i++) {
    const album = genuinelyNew[i];
    process.stdout.write(`  [${i + 1}/${genuinelyNew.length}] ${album.name.substring(0, 55)}... `);

    const { img, photos } = await fetchAlbumImage(album.yupooUrl);

    const cats     = categorizeCats(album.name, album.kitzoneCat);
    const sizes    = detectSizes(album.name);
    const priceUsd = getPrice(cats, album.name);
    const type     = cats.includes('retro') ? 'retro' : 'normal';

    newProducts.push({
      id:           album.id,
      nameEs:       album.name,
      nameEn:       album.name,
      cats,
      type,
      priceUsd,
      provider:     'xie',                        // identifica el proveedor
      yupooCategory: album.kitzoneCat,
      yupooUrl:     album.yupooUrl,
      img,
      photos,
      sizes,
    });

    console.log(img ? `OK (${photos} fotos)` : 'Sin imagen');
    await sleep(DELAY_ALBUM);

    // Checkpoint cada 50
    if (!DRY_RUN && (i + 1) % 50 === 0) {
      const snapshot = [...existing, ...newProducts];
      fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(snapshot, null, 2));
      console.log(`  >> Checkpoint: ${snapshot.length} productos totales`);
    }
  }

  // ── Fase 5: Marcar avisoStock en productos del catálogo no encontrados en Xie ──
  //
  // Un producto del catálogo anterior NO está en Xie si:
  //  - No tiene provider:'xie' (es del catálogo antiguo ggjersey)
  //  - Y ningún álbum de Xie coincide con él en el matching fuzzy
  //
  // Los que SÍ tienen provider:'xie' ya importados no se tocan.

  let avisoCount = 0;
  const avisoNames = [];

  if (!NO_AVISO) {
    console.log('\n── Fase 5: Detectando productos sin stock en nuevo proveedor ──');

    // Pre-computar info de todos los álbumes de Xie (para el matching inverso)
    const xieInfos = allXieAlbums.map(a => ({ name: a.name, info: extractKitInfo(a.name) }));

    for (const ep of existing) {
      // Solo procesar productos del proveedor anterior (no tocar los ya importados de Xie)
      if (ep.provider === 'xie') continue;
      // Si ya tiene avisoStock, no sobreescribir (puede haberse puesto manualmente)
      if (ep.avisoStock) continue;

      const epName  = ep.nameEn || ep.nameEs || '';
      const epInfo  = extractKitInfo(epName);
      let   found   = false;

      for (const xa of xieInfos) {
        const score = matchScore(epName, xa.name);
        if (score >= MATCH_THRESHOLD) { found = true; break; }
      }

      if (!found) {
        ep.avisoStock = true;
        avisoCount++;
        avisoNames.push(epName.substring(0, 60));
      }
    }

    console.log(`  Productos marcados como avisoStock:true → ${avisoCount}`);
    if (avisoNames.length > 0 && DRY_RUN) {
      avisoNames.slice(0, 20).forEach(n => console.log(`    ⚠️  ${n}`));
      if (avisoNames.length > 20) console.log(`    ... y ${avisoNames.length - 20} más`);
    }
  }

  // ── Guardar ───────────────────────────────────────────────────────────────
  const finalProducts = [...existing, ...newProducts];

  if (!DRY_RUN) {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(finalProducts, null, 2));
    console.log(`\n✅ products.json guardado: ${finalProducts.length} productos totales`);
  } else {
    console.log(`\n[DRY RUN] Se habrían guardado ${finalProducts.length} productos`);
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  RESUMEN                                                  ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Álbumes totales en Xie:       ${String(allXieAlbums.length).padEnd(26)}║`);
  console.log(`║  Coinciden con catálogo:        ${String(matchedCount).padEnd(25)}║`);
  console.log(`║  Nuevos añadidos:               ${String(newProducts.length).padEnd(25)}║`);
  console.log(`║  Marcados avisoStock:true:      ${String(avisoCount).padEnd(25)}║`);
  console.log(`║  Total productos en catálogo:   ${String(finalProducts.length).padEnd(25)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  if (!DRY_RUN && (newProducts.length > 0 || avisoCount > 0)) {
    console.log('\n  Siguiente paso:');
    console.log('    git add data/products.json');
    console.log('    git commit -m "Catálogo actualizado: nuevos productos Xie + avisoStock"');
    console.log('    git push');
  }
}

main().catch(err => {
  console.error('\n💥 Error fatal:', err.message);
  process.exit(1);
});
