/**
 * Compara el listado del nuevo proveedor (data/newsupplier-raw.json) contra
 * nuestro catálogo actual (data/products.json) para las 5 grandes ligas.
 *
 * - Temporada actual (26/27 o sin año claro): se compara equipo + tipo de
 *   variante (local/visitante/tercera/cuarta/portero/manga larga/jugador/
 *   mujer/niño/especial), ignorando el año exacto.
 * - Retro / temporadas antiguas (año < 2026, o con la palabra "retro"/
 *   "vintage style"): se compara equipo + TEMPORADA EXACTA + tipo de
 *   variante, porque aquí cada año es un producto distinto y es donde
 *   reside el valor real del catálogo del nuevo proveedor.
 *
 * Además se filtra estrictamente contra una lista de equipos reales de las
 * 5 grandes ligas (temporada 26/27) para no colar equipos de otras ligas
 * mal etiquetados por el proveedor (Championship inglesa, liga escocesa,
 * turca, neerlandesa, etc.)
 */
const fs = require('fs');
const path = require('path');

const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const NEWSUP_FILE    = path.join(__dirname, 'data', 'newsupplier-raw.json');
const OUT_REPORT     = path.join(__dirname, 'data', 'newsupplier-candidates.json');

const BIG5 = ['laliga', 'premier', 'seriea', 'bundesliga', 'ligue1'];

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ─── Listas de equipos reales 26/27 por liga (para filtrar ruido de categorías) ──
// Se usa de forma laxa (substring/contención tras normalizar), no exacta.
const LEAGUE_TEAMS = {
  laliga: [
    'real madrid','barcelona','atletico madrid','athletic bilbao','athletic club','villarreal',
    'real betis','celta vigo','rayo vallecano','osasuna','real sociedad','mallorca','getafe',
    'girona','sevilla','valencia','espanyol','alaves','elche','levante','real oviedo',
  ],
  premier: [
    'liverpool','arsenal','manchester city','chelsea','newcastle','aston villa','nottingham forest','nottm forest',
    'brighton','fulham','bournemouth','brentford','crystal palace','everton','west ham','manchester united',
    'wolves','wolverhampton','tottenham','burnley','leeds','sunderland',
  ],
  seriea: [
    'napoli','inter milan','atalanta','juventus','ac milan',' milan ','bologna','roma','lazio','fiorentina',
    'como','torino','udinese','genoa','cagliari','verona','parma','lecce','cremonese','sassuolo','pisa',
  ],
  bundesliga: [
    'bayern munich','bayer leverkusen','rb leipzig','eintracht frankfurt','borussia dortmund','mainz',
    'freiburg','stuttgart','monchengladbach','borussia monchengladbach','werder bremen','wolfsburg',
    'union berlin','augsburg','st pauli','hoffenheim','heidenheim','koln','cologne','hamburger','hamburg sv',
  ],
  ligue1: [
    'psg','paris saint','paris sg','marseille','monaco','lille','lyon','lens','nice','rennes','strasbourg',
    'toulouse','auxerre','angers','brest','nantes','le havre','metz','paris fc','lorient',
  ],
};

function isRealTeamOfLeague(normTeam, cat) {
  const list = LEAGUE_TEAMS[cat] || [];
  return list.some(t => normTeam.includes(t) || t.includes(normTeam) || similar(t, normTeam));
}

// Alias de abreviaturas / traducciones inglesas de nombres de ciudad que
// usa este proveedor y que rompían el reconocimiento de equipo.
const TEAM_ALIASES = [
  [/\bm[\s-]*u\b/g, 'manchester united'],
  [/\bflorence\b/g, 'fiorentina'],
  [/\bnaples\b/g, 'napoli'],
  [/\bmunich\b/g, 'munich'], // sin cambio, solo asegurar límite de palabra
];

function normalizeTeam(rawName) {
  let s = ' ' + rawName + ' ';
  s = stripAccents(s).toLowerCase();
  for (const [re, repl] of TEAM_ALIASES) s = s.replace(re, repl);
  s = s.replace(/\b(19|20)\d{2}\s*\/\s*\d{2,4}\b/g, ' ');
  s = s.replace(/\b\d{2}\s*\/\s*\d{2,4}\b/g, ' ');
  s = s.replace(/\b(19|20)\d{2}\b/g, ' ');
  s = s.replace(/\bs\s*-\s*\d?xl\b/g, ' ');
  s = s.replace(/\bs\s*-\s*xxl\b/g, ' ');
  s = s.replace(/\bxs\s*-\s*\d?xl\b/g, ' ');
  s = s.replace(/[：:]/g, ' ');
  s = s.replace(/\b\d{1,3}\s*-\s*\d{1,3}\b/g, ' '); // tallas kids/baby, ej. 16-28, 9-12
  const stop = [
    'jersey','shirt','t-shirt','tshirt','kit',
    'home','away','third','fourth','local','visitante','tercera','cuarta',
    'goalkeeper','portero','gk','black','blue','green','red','white','orange','pink','yellow','purple','grey','gray','navy',
    'long sleeve','long sleeved','long sleeves','manga larga',
    'player version','player','version jugador','fan version','fan',
    'pre-match','prematch','pre match','training','vintage style','special edition','anniversary edition',
    'centenary edition','champion edition','retro','womens',"women's",'women','kids','crop',
    '2-star','2 star','2-stars','2 stars','world cup','edition','special','size',
  ];
  for (const w of stop) {
    s = s.replace(new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), ' ');
  }
  s = s.replace(/[^a-z0-9 ]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function yearFull(y) {
  const n = parseInt(y, 10);
  if (y.length === 4) return n;
  return n <= 30 ? 2000 + n : 1900 + n;
}

function extractSeason(name) {
  let m = name.match(/\b(\d{2,4})\s*\/\s*(\d{2,4})\b/);
  if (m) {
    const y1 = yearFull(m[1]);
    const y2raw = m[2];
    const y2 = y2raw.length >= 4 ? parseInt(y2raw, 10) : yearFull(y2raw);
    return `${y1}/${String(y2).slice(-2)}`;
  }
  m = name.match(/\b(19|20)\d{2}\b/);
  if (m) return String(parseInt(m[0], 10));
  return null;
}

function seasonStartYear(season) {
  if (!season) return null;
  const m = season.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

function variantFlags(rawName) {
  const s = stripAccents(rawName).toLowerCase();
  return {
    home:        (/\bhome\b|\blocal\b/.test(s)) && !/\baway\b/.test(s),
    away:        /\baway\b|\bvisitante\b/.test(s),
    third:       /\bthird\b|\btercera\b/.test(s),
    fourth:      /\bfourth\b|\bcuarta\b/.test(s),
    gk:          /\bgoalkeeper\b|\bportero\b|\bgk\b/.test(s),
    longSleeve:  /long\s*sleeves?|manga\s*larga/.test(s),
    player:      /\bplayer\b|version jugador|versión jugador/.test(s),
    special:     /special edition|anniversary edition|centenary edition|champion edition|pre-?match|\btraining\b/.test(s),
    women:       /\bwomens?\b|women's|\bcrop\b/.test(s),
    kids:        /\bkids?\b/.test(s),
  };
}

function isExplicitRetro(rawName) {
  const s = stripAccents(rawName).toLowerCase();
  return /\bretro\b|vintage style/.test(s);
}

function fingerprint(flags) {
  return Object.entries(flags).filter(([, v]) => v).map(([k]) => k).sort().join(',') || 'base';
}

function similar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const ta = new Set(a.split(' ').filter(w => w.length > 2));
  const tb = new Set(b.split(' ').filter(w => w.length > 2));
  if (ta.size === 0 || tb.size === 0) return false;
  let common = 0;
  for (const w of ta) if (tb.has(w)) common++;
  const minSize = Math.min(ta.size, tb.size);
  return common / minSize >= 0.6;
}

// true si el nombre corresponde a temporada "retro/histórica" (año < 2026 o palabra retro)
function isHistoric(name) {
  if (isExplicitRetro(name)) return true;
  const season = extractSeason(name);
  const y = seasonStartYear(season);
  if (y === null) return false; // sin año explícito => se trata como actual
  return y < 2026;
}

function buildEntry(name) {
  const flags = variantFlags(name);
  const historic = isHistoric(name);
  const season = historic ? extractSeason(name) : null;
  const fp = fingerprint(flags);
  const matchKey = historic ? `retro|${season || '?'}|${fp}` : `current|${fp}`;
  return { team: normalizeTeam(name), flags, fp, historic, season, matchKey };
}

function main() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
  const newsupplier = JSON.parse(fs.readFileSync(NEWSUP_FILE, 'utf-8'));

  const ours = {};
  for (const cat of BIG5) ours[cat] = [];
  for (const p of products) {
    const cats = p.cats || [];
    for (const cat of BIG5) {
      if (cats.includes(cat)) {
        const name = p.nameEn || p.nameEs || '';
        ours[cat].push({ ...buildEntry(name), name, id: p.id });
      }
    }
  }

  const report = { newCurrentVariant: [], newRetro: [], rejectedWrongLeague: [], alreadyHave: [] };

  for (const item of newsupplier) {
    const cat = item.kitzoneCat;
    if (!BIG5.includes(cat)) continue;
    const entry = buildEntry(item.name);

    if (!isRealTeamOfLeague(entry.team, cat)) {
      report.rejectedWrongLeague.push({ ...item, normTeam: entry.team });
      continue;
    }

    const sameTeamProducts = ours[cat].filter(x => isRealTeamOfLeague(x.team, cat) && similar(x.team, entry.team));
    const haveIt = sameTeamProducts.some(x => x.matchKey === entry.matchKey);

    const enriched = { ...item, ...entry, ourProductsForTeam: sameTeamProducts.map(x => x.name) };
    if (haveIt) {
      report.alreadyHave.push(enriched);
    } else if (entry.historic) {
      report.newRetro.push(enriched);
    } else {
      report.newCurrentVariant.push(enriched);
    }
  }

  fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2));

  console.log('=== Resumen comparación (v2: retro por temporada exacta + filtro de liga real) ===');
  console.log('Total nuevo proveedor (5 ligas):', newsupplier.filter(i => BIG5.includes(i.kitzoneCat)).length);
  console.log('Rechazados por liga incorrecta:', report.rejectedWrongLeague.length);
  console.log('Ya lo tenemos:', report.alreadyHave.length);
  console.log('Nuevo — temporada actual:', report.newCurrentVariant.length);
  console.log('Nuevo — retro/histórico:', report.newRetro.length);

  for (const [label, bucket] of [['actual', report.newCurrentVariant], ['retro', report.newRetro]]) {
    console.log(`\n--- Por liga (${label}) ---`);
    for (const cat of BIG5) console.log(' ', cat, bucket.filter(x => x.kitzoneCat === cat).length);
  }
}

main();
