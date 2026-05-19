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
      'girona', 'la coruna', 'deportivo',
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
      'frankfurt', 'eintracht', 'schalke', 'hamburg', 'werder', 'bremen',
      'union berlin', 'koln',
    ],
  },
  {
    cat: 'ligue1',
    keywords: ['psg', 'paris saint', 'marseille', 'lyon', 'lens', 'monaco', 'rennes'],
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
    ],
  },
  {
    cat: 'sudamerica',
    keywords: [
      'flamengo', 'palmeiras', 'corinthians', 'sao paulo', 'fluminense',
      'atletico mineiro', 'botafogo', 'vasco', 'santos', 'cruzeiro',
      'gremio', 'internacional', 'river plate', 'boca juniors', 'boca',
      'racing club', 'independiente', 'san lorenzo', 'colo colo',
      'club america', 'america', 'chivas', 'guadalajara', 'cruz azul',
      'monterrey', 'atletico nacional', 'millonarios', 'olimpo',
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

// Retro: si contiene la palabra "Retro" o un año antes de 2020
const RETRO_YEAR_RE = /\b(19\d{2}|200[0-9]|201[0-9])\b/;
const RETRO_SLASH_RE = /\b\d{2}\/\d{2}\b/; // ej: 98/99, 00/01, 84/85

function isRetro(name) {
  const n = name.toLowerCase();
  if (n.includes('retro')) return true;
  if (RETRO_YEAR_RE.test(name)) {
    // confirmar que es año futbolero (antes de 2020)
    const years = name.match(/\b(19\d{2}|200[0-9]|201[0-9])\b/g) || [];
    if (years.some(y => parseInt(y) < 2020)) return true;
  }
  if (RETRO_SLASH_RE.test(name)) return true;
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

const FOOTBALL_CATS = new Set(['laliga', 'premier', 'seriea', 'bundesliga', 'ligue1', 'selecciones', 'sudamerica', 'retro']);

function categorize(name) {
  const lower = name.toLowerCase();

  // Retro tiene prioridad
  if (isRetro(name)) return 'retro';

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

  const products = raw.map(p => {
    const cat = categorize(p.name);
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
