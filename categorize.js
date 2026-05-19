/**
 * KitZone Categorizador
 * Lee products-raw.json y genera products.json con categorías, tallas y precios.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const RAW_FILE = path.join(DATA_DIR, 'products-raw.json');
const OUT_FILE = path.join(DATA_DIR, 'products.json');

// ─── Reglas de categorización ────────────────────────────────────────────────

const CATEGORY_RULES = [
  {
    cat: 'laliga',
    keywords: [
      'real madrid', 'barcelona', 'atletico madrid', 'atletico de madrid',
      'betis', 'sevilla', 'bilbao', 'athletic bilbao', 'valencia', 'villarreal',
      'celta', 'osasuna', 'espanyol', 'malaga', 'zaragoza', 'valladolid',
      'oviedo', 'real sociedad', 'sociedad', 'santander', 'racing santander',
      'girona', 'la coruna', 'deportivo', 'cadiz', 'cordoba',
    ],
  },
  {
    cat: 'premier',
    keywords: [
      'manchester city', 'arsenal', 'liverpool', 'chelsea',
      'manchester united', 'man united', 'man city', 'tottenham', 'spurs',
      'newcastle', 'west ham', 'wolves', 'wolverhampton', 'leicester',
      'fulham', 'aston villa', 'leeds', 'everton', 'brighton',
      'crystal palace', 'bournemouth', 'nottingham', 'celtic', 'rangers',
      'sunderland',
    ],
  },
  {
    cat: 'seriea',
    keywords: [
      'inter milan', 'inter', 'ac milan', 'napoli', 'roma', 'lazio',
      'juventus', 'atalanta', 'fiorentina', 'venezia', 'parma',
    ],
  },
  {
    cat: 'bundesliga',
    keywords: [
      'bayern', 'dortmund', 'bvb', 'leverkusen', 'leipzig', 'rb leipzig',
      'frankfurt', 'eintracht', 'schalke', 'hamburg', 'hamburger', 'werder', 'bremen',
      'union berlin', 'koln', 'augsburg', 'hoffenheim', 'freiburg', 'mainz',
    ],
  },
  {
    cat: 'ligue1',
    keywords: [
      'psg', 'paris saint', 'marseille', 'lyon', 'lens', 'monaco', 'rennes',
      'rennais', 'metz', 'strasbourg',
    ],
  },
  {
    cat: 'selecciones',
    keywords: [
      'france', 'england', 'brasil', 'brazil', 'netherlands', 'holland',
      'germany', 'deutschland', 'portugal', 'spain', 'españa', 'argentina',
      'japan', 'italy', 'italia', 'usa', 'united states', 'belgium',
      'mexico', 'scotland', 'korea', 'south korea', 'uruguay', 'wales',
      'ireland', 'colombia', 'croatia', 'chile', 'norway', 'turkey',
      'jamaica', 'morocco', 'ukraine', 'australia', 'haiti', 'paraguay',
      'ecuador', 'peru', 'greece', 'albania',
      'hungary', 'canada', 'sweden', 'congo',
    ],
  },
  {
    // Clubes europeos sin liga propia — va ANTES de sudamerica para tener prioridad
    cat: 'europa',
    keywords: [
      'aik', 'rosenborg', 'bodøglimt', 'bodo/glimt', 'bodo glimt',
      'red star belgrade', 'red star', 'crvena zvezda',
      'olympiacos', 'galatasaray', 'besiktas', 'fenerbahce',
      'porto', 'benfica', 'sporting cp', 'sporting lisbon',
      'ajax', 'psv', 'anderlecht', 'bruges', 'club brugge',
    ],
  },
  {
    cat: 'sudamerica',
    keywords: [
      'flamengo', 'palmeiras', 'corinthians', 'sao paulo', 'fluminense',
      'atletico mineiro', 'atletico paranaense', 'botafogo', 'vasco', 'santos',
      'cruzeiro', 'gremio', 'grêmio', 'internacional', 'river plate',
      'boca juniors', 'boca', 'racing club', 'independiente', 'estudiantes',
      'san lorenzo', 'colo colo', 'club america', 'chivas',
      'guadalajara', 'cruz azul', 'monterrey', 'atletico nacional', 'millonarios',
      'olimpo', 'olimpia', 'victoria', 'penarol',
      'new york city', 'nycfc', 'los angeles fc', 'lafc',
      'vancouver', 'whitecaps',
      // Selecciones CONCACAF/Centroamérica
      'guatemala', 'honduras', 'costa rica',
    ],
  },
  {
    cat: 'nba',
    keywords: [
      'nba', 'lakers', 'bulls', 'warriors', 'celtics', 'heat', 'knicks',
      'bucks', 'nets', 'suns', 'nuggets', 'mavericks', '76ers', 'sixers',
      'cavaliers', 'grizzlies', 'raptors', 'spurs', 'thunder', 'blazers',
      'trail blazers', 'magic', 'wizards', 'pelicans', 'jazz', 'kings',
      'pistons', 'hawks', 'hornets', 'pacers', 'timberwolves', 'rockets',
      'clippers', 'mitchellness', 'mitchell & ness',
    ],
  },
  {
    cat: 'nfl',
    keywords: ['nfl'],
  },
  {
    cat: 'streetwear',
    keywords: [
      'gallery dept', 'bape', 'amiri', 'palm angels', 'chrome hearts',
      'off white', 'off-white', 'hellstar', 'trapstar', 'sp5der', 'vlone',
      'rhude', 'fog', 'fear of god', 'corteiz', 'purple brand',
      'casablanca', 'ami paris', 'ih nom uh nit', 'denim tears',
    ],
  },
  {
    cat: 'windbreaker',
    keywords: ['windbreaker', 'wind breaker', 'cortavientos'],
  },
  {
    cat: 'kids',
    keywords: ['kid', 'baby', 'kids kit', 'youth', 'children', '9-12', '9–12'],
  },
  {
    cat: 'women',
    keywords: ['women', 'woman', 'female', 'ladies', 'mujer'],
  },
];

// Retro: palabra "Retro" explícita, año largo anterior a 2020,
// o temporada corta XX/YY donde ambos números NO estén en la década 2020-2029.
// Ejemplos retro:  98/99, 00/01, 84/85, 19/20
// Ejemplos NO retro: 20/21, 24/25, 25/26, 26/27
const RETRO_YEAR_RE  = /\b(19\d{2}|200[0-9]|201[0-9])\b/;
const SLASH_SEASON_RE = /\b(\d{2})\/(\d{2})\b/;
const MODERN_DECADE_RE = /\b(2[0-9])\/(2[0-9])\b/; // ambos en los 20 → temporada actual

function isRetro(name) {
  const n = name.toLowerCase();
  if (n.includes('retro')) return true;
  // Año largo (4 dígitos) anterior a 2020
  if (RETRO_YEAR_RE.test(name)) return true;
  // Temporada corta XX/YY: retro solo si alguno de los dos no pertenece a la década 2020s
  if (SLASH_SEASON_RE.test(name) && !MODERN_DECADE_RE.test(name)) return true;
  return false;
}

// ─── Detección de tallas ─────────────────────────────────────────────────────

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
  for (const { re, sizes } of SIZE_RANGES) {
    if (re.test(name)) return sizes;
  }
  return DEFAULT_SIZES;
}

// ─── Categorización ───────────────────────────────────────────────────────────

const FOOTBALL_CATS = new Set(['laliga', 'premier', 'seriea', 'bundesliga', 'ligue1', 'selecciones', 'sudamerica', 'retro', 'europa', 'nuevatemporada']);

// Categorías válidas que el scraper puede enviar en yupooCategory
const VALID_CATS = new Set([
  'laliga', 'premier', 'seriea', 'bundesliga', 'ligue1', 'selecciones',
  'sudamerica', 'europa', 'retro', 'nba', 'nfl', 'streetwear',
  'windbreaker', 'kids', 'women', 'nuevatemporada',
]);

// Detecta la temporada 26/27 en cualquiera de sus formas escritas
const NEW_SEASON_RE = /26\/27|2026\/27|2026-27/;

/**
 * Determina la categoría de un producto.
 * Orden de prioridad:
 *   ① Nueva temporada 26/27 (por nombre — siempre prioritario)
 *   ② yupooCategory del scraper (fuente directa de Yupoo)
 *   ③ Retro (por nombre)
 *   ④ Reglas de keywords por nombre
 *   ⑤ 'otros' como fallback
 */
function categorize(name, yupooCategory) {
  const lower = name.toLowerCase();

  // ① Nueva temporada — máxima prioridad independientemente del origen
  if (NEW_SEASON_RE.test(name)) return 'nuevatemporada';

  // ② Categoría directa del scraper (solo si es un valor reconocido)
  if (yupooCategory && VALID_CATS.has(yupooCategory)) {
    // Dentro de la categoría del scraper, retro por nombre sigue aplicándose
    if (isRetro(name)) return 'retro';
    return yupooCategory;
  }

  // ③ Retro por nombre (cuando no hay categoría del scraper)
  if (isRetro(name)) return 'retro';

  // ④ Reglas de keywords
  for (const { cat, keywords } of CATEGORY_RULES) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return cat;
    }
  }

  return 'otros';
}

// ─── Precios base ─────────────────────────────────────────────────────────────

function getPrice(cat, name) {
  if (cat === 'retro' || name.toLowerCase().includes('retro')) return 13;
  return 8;
}

// ─── Procesado principal ──────────────────────────────────────────────────────

function main() {
  console.log('=== KitZone Categorizador ===');

  if (!fs.existsSync(RAW_FILE)) {
    console.error(`Error: No se encontró ${RAW_FILE}`);
    console.error('Ejecuta primero: node scraper.js');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(RAW_FILE, 'utf-8'));
  console.log(`Productos a procesar: ${raw.length}`);

  // Estadísticas de cobertura de yupooCategory
  const withYupooCategory = raw.filter(p => p.yupooCategory).length;
  console.log(`Con yupooCategory del scraper: ${withYupooCategory} (${Math.round(withYupooCategory / raw.length * 100)}%)`);

  const products = raw.map(p => {
    const cat = categorize(p.name, p.yupooCategory);
    const sizes = detectSizes(p.name);
    const priceUsd = getPrice(cat, p.name);
    const type = (cat === 'retro' || p.name.toLowerCase().includes('retro')) ? 'retro' : 'normal';

    return {
      id: p.id,
      nameEs: p.name,
      nameEn: p.name,
      cat,
      type,
      priceUsd,
      yupooCategory: p.yupooCategory || null,   // conservar para trazabilidad
      yupooUrl: p.yupooUrl,
      img: p.img || null,
      photos: p.photos || 0,
      sizes,
    };
  });

  // Estadísticas
  const stats = {};
  for (const p of products) {
    stats[p.cat] = (stats[p.cat] || 0) + 1;
  }
  console.log('\nDistribución por categoría:');
  for (const [cat, count] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(14)}: ${count}`);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(products, null, 2), 'utf-8');
  console.log(`\nGuardado: ${OUT_FILE} (${products.length} productos)`);
}

main();
