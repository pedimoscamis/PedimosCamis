'use strict';
/**
 * Parser de títulos de álbum (Yupoo) → atributos del producto.
 *
 * Es la pieza crítica del agente: decide si un álbum entra en el catálogo y
 * con qué categorías/tallas/precio. Principio rector: ante la duda NO se
 * añade — el álbum va a `review` con el motivo, nunca se adivina.
 *
 * Reutiliza deliberadamente las mismas reglas que categorize.js
 * (isRetro, NEW_SEASON_RE, detectSizes, getPrice, orden de cats) para que un
 * producto del agente sea indistinguible de uno scrapeado de siempre.
 */
const { TEAMS } = require('./teams');

// ─── Normalización ───────────────────────────────────────────────────────────
function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Minúsculas, sin acentos, puntuación → espacio (para comparar alias). */
function norm(s) {
  return stripAccents(String(s))
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bf c\b/g, 'fc')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Índice de alias ─────────────────────────────────────────────────────────
// Se ordena por longitud para que el match más largo gane ("inter miami" > "inter").
const ALIASES = [];
for (const [scope, canonical, aliases] of TEAMS) {
  for (const a of aliases) ALIASES.push({ scope, canonical, alias: norm(a) });
}
ALIASES.sort((a, b) => b.alias.length - a.alias.length);

/** Devuelve todos los matches con posición, quitando los contenidos en otro más largo. */
function findTeamMatches(text) {
  const padded = ` ${text} `;
  const found = [];
  for (const e of ALIASES) {
    const needle = ` ${e.alias} `;
    let from = 0;
    for (;;) {
      const i = padded.indexOf(needle, from);
      if (i === -1) break;
      found.push({ ...e, start: i, end: i + needle.length });
      from = i + 1;
    }
  }
  // quitar matches cuyo rango está dentro de otro más largo
  return found.filter(m => !found.some(o =>
    o !== m && o.start <= m.start && o.end >= m.end && (o.end - o.start) > (m.end - m.start)));
}

// ─── Temporada ───────────────────────────────────────────────────────────────
/**
 * Devuelve { label, start, end, kind } o null.
 *   "2026/27" "2026/2027" "26/27" "2026-27" → temporada partida
 *   "2026" (suelto)                          → año natural (Mundial, selecciones)
 */
function parseSeason(raw) {
  let m = raw.match(/\b(19|20)(\d{2})\s*[\/\-]\s*((?:19|20)?\d{2})\b/);
  if (m) {
    const start = parseInt(m[1] + m[2], 10);
    const endRaw = m[3].length === 4 ? m[3].slice(2) : m[3];
    return { label: `${m[1]}${m[2]}/${endRaw}`, start, end: parseInt(endRaw, 10), kind: 'split' };
  }
  m = raw.match(/\b(\d{2})\s*[\/]\s*(\d{2})\b/);
  if (m) {
    const s = parseInt(m[1], 10);
    const start = s >= 50 ? 1900 + s : 2000 + s;
    return { label: `${start}/${m[2]}`, start, end: parseInt(m[2], 10), kind: 'split' };
  }
  m = raw.match(/\b(19\d{2}|20\d{2})\b/);
  if (m) return { label: m[1], start: parseInt(m[1], 10), end: null, kind: 'year' };
  return null;
}

// Misma lógica que categorize.js::isRetro
const RETRO_YEAR_RE = /\b(19\d{2}|200[0-9]|201[0-9])\b/;
const SLASH_SEASON_RE = /\b(\d{2})\/(\d{2})\b/;
const MODERN_DECADE_RE = /\b(2[0-9])\/(2[0-9])\b/;
function isRetro(name) {
  if (name.toLowerCase().includes('retro')) return true;
  if (RETRO_YEAR_RE.test(name)) return true;
  if (SLASH_SEASON_RE.test(name) && !MODERN_DECADE_RE.test(name)) return true;
  return false;
}
// Misma regex que categorize.js::NEW_SEASON_RE
const NEW_SEASON_RE = /26\/27|2026\/27|2026-27/;

// ─── Tallas (categorize.js::detectSizes + niños con rango implícito) ─────────
const SIZE_RANGES = [
  { re: /S[-–]4XL|S\s*-\s*4XL/i, sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'] },
  { re: /S[-–]3XL|S\s*-\s*3XL/i, sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'] },
  { re: /S[-–](XXL|2XL)|S\s*-\s*(XXL|2XL)/i, sizes: ['S', 'M', 'L', 'XL', '2XL'] },
  { re: /S[-–]XL|S\s*-\s*XL/i, sizes: ['S', 'M', 'L', 'XL'] },
  { re: /16[-–：]28|size[：:]\s*16[-–]28/i, sizes: ['16', '18', '20', '22', '24', '26', '28'] },
  { re: /9[-–]12|size[：:]\s*9[-–]12/i, sizes: ['9', '10', '11', '12'] },
];
const DEFAULT_SIZES = ['S', 'M', 'L', 'XL', '2XL'];
const KIDS_DEFAULT_SIZES = ['16', '18', '20', '22', '24', '26', '28'];
function detectSizes(name, isKids) {
  for (const { re, sizes } of SIZE_RANGES) if (re.test(name)) return sizes;
  return isKids ? KIDS_DEFAULT_SIZES : DEFAULT_SIZES;
}

// ─── Atributos por palabras clave ────────────────────────────────────────────
const NON_JERSEY_RE = /\b(windbreaker|windbraker|wind\s*breaker|jackets?|tracksuits?|track\s+suits?|shorts?|pants|trousers|hoodies?|sweatshirts?|sweaters?|vests?|polos?|socks?|caps?|hats?|scarf|bags?|backpacks?|bottoms?|raincoat|coats?|singlets?|tank\s+tops?|basketball|nba|nfl|mlb|f1|formula|umbrella|training|trainng|traing|warm[\s-]*up|coach|sweat|fleece|anthem|presentation|leaked|swingman|round\s+neck|v[\s-]*neck|city\s+edition|icon\s+edition|statement\s+edition|association\s+edition)\b/i;
const BABY_RE = /\bbaby\b|\b9\s*[-–]\s*12\b/i;
const CROP_RE = /\bcrop\b/i;
const PREMATCH_RE = /\bpre[\s-]*match\b/i;
const KIDS_RE = /\b(kids?|baby|youth|children|child|toddler)\b|\b16\s*[-–]\s*28\b|\b9\s*[-–]\s*12\b/i;
const WOMEN_RE = /\b(women|womens|woman|ladies|female|femenin\w*|mujer)\b/i;
const LONG_SLEEVE_RE = /\blong\s*sleeves?\b|\bl\s*\/\s*s\b/i;
const PLAYER_RE = /\bplayer\s*(version|edition)?\b/i;
const GK_RE = /\b(goalkeeper|goal\s*keeper|keeper|gk)\b/i;
const SPECIAL_RE = /\b(special|concept\w*|anniversary|aniversario|limited|commemorative|x\s+\w+|originals?|trefoil|collab\w*|edition)\b/i;
const VARIANT_RES = [
  ['fourth', /\b(fourth|4th)\b/i],
  ['third', /\b(third|3rd|iii)\b/i],
  ['away', /\b(away|second|2nd|ii)\b/i],
  ['home', /\bhome\b/i],
];

// Palabras que describen el artículo y no identifican equipo (para el residuo).
const NOISE = new Set((
  'jersey jerseys jesrey jersy jerseys shirt shirts kit kits kid kids size szie sizes version fan fans player ' +
  'edition home away third fourth 3rd 4th goalkeeper gk keeper long sleeve sleeves women womens woman ladies ' +
  'retro the and of for new original originals special concept limited kit fc cf afc youth baby second 2nd ii iii'
).split(' '));

// Residuo que delata un equipo NO reconocido (club distinto, filial, juvenil…):
// si tras quitar el alias del equipo queda alguna de estas palabras, no nos fiamos.
const SUSPECT = new Set((
  'university universidad universitario nacional deportivo sporting athletic club united city real ca atletico ' +
  'b castilla mestalla reserves academy u17 u18 u19 u20 u21 u23 juniors youth'
).split(' '));

// Convención de la tienda (categorize.js): selecciones CONCACAF/Centroamérica cuelgan de 'sudamerica'
const CAT_OVERRIDE = { 'Guatemala': 'sudamerica', 'Costa Rica': 'sudamerica', 'Honduras': 'sudamerica' };

// ─── Parser principal ────────────────────────────────────────────────────────
/**
 * @returns {object} {
 *   verdict: 'include' | 'skip' | 'review',
 *   reason: string,
 *   ...atributos
 * }
 */
function parseTitle(title, cfg = {}) {
  const raw = String(title).replace(/\s+/g, ' ').trim();
  const t = {
    title: raw,
    verdict: 'skip',
    reason: '',
    team: null, scope: null,
    season: null, retro: false, kids: false, baby: false, crop: false, prematch: false, women: false,
    longSleeve: false, player: false, goalkeeper: false, special: false, specialTag: '',
    variant: null, residual: [],
  };

  // 1) No-camisetas fuera (chaquetas, shorts, entrenamiento, baloncesto…)
  if (NON_JERSEY_RE.test(raw)) { t.reason = 'no-camiseta'; return t; }

  // 2) Atributos explícitos
  t.kids = KIDS_RE.test(raw);
  t.baby = BABY_RE.test(raw);
  t.crop = CROP_RE.test(raw);
  t.prematch = PREMATCH_RE.test(raw);
  t.women = WOMEN_RE.test(raw);
  t.longSleeve = LONG_SLEEVE_RE.test(raw);
  t.player = PLAYER_RE.test(raw);
  t.goalkeeper = GK_RE.test(raw);
  const sp = raw.match(SPECIAL_RE);
  t.special = !!sp;
  t.specialTag = sp ? sp[0].toLowerCase().replace(/\s+/g, ' ') : '';
  t.season = parseSeason(raw);
  // Retro por temporada, no por cualquier año del título ("Como 1907" es el año de fundación).
  // La palabra "Retro" solo cuenta si la temporada no es actual (diseños "retro" de 2026 no son retro).
  t.retro = t.season
    ? (t.season.start < 2020 || (/retro/i.test(raw) && t.season.start < 2024))
    : /retro/i.test(raw);
  for (const [name, re] of VARIANT_RES) if (re.test(raw)) { t.variant = name; break; }
  if (t.goalkeeper) t.variant = t.variant ? `${t.variant}-gk` : 'gk';

  // 3) Retro fuera (configurable)
  if (t.retro && cfg.includeRetro === false) { t.reason = 'retro'; return t; }

  // 4) Temporada: obligatoria y reciente
  if (!t.season) { t.verdict = 'review'; t.reason = 'sin-temporada'; return t; }
  if (t.season.start > (cfg.maxSeasonStart ?? 2026)) { t.reason = `temporada-futura(${t.season.label})`; return t; }
  if (!t.retro && t.season.start < (cfg.minSeasonStart ?? 0)) { t.reason = `temporada-antigua(${t.season.label})`; return t; }

  // 5) Equipo
  const text = norm(
    raw.replace(/\b(19|20)?\d{2}\s*[\/\-]\s*(?:19|20)?\d{2}\b/g, ' ')   // temporada
       .replace(/\bS\s*[-–]\s*\d?X{0,2}L\b/gi, ' ')                      // tallas S-4XL
       .replace(/\b\d{1,2}\s*[-–]\s*\d{1,2}\b/g, ' ')                    // 16-28 / 9-12
       .replace(/\b(19|20)\d{2}\b/g, ' ')                                // año suelto
  );
  const matches = findTeamMatches(text);
  if (matches.length === 0) {
    t.verdict = 'review'; t.reason = 'equipo-desconocido'; t.residual = residualTokens(text, []);
    return t;
  }

  // 'Jordan' es a la vez selección y marca (Brazil x Jordan): solo vale si no hay nada más
  let ms = matches;
  if (ms.length > 1) ms = ms.filter(m => m.canonical !== 'Jordan');
  if (ms.every(m => m.scope === 'out')) {
    t.team = ms[0].canonical; t.scope = 'out'; t.inScope = false;
    t.reason = `fuera-de-alcance(${[...new Set(ms.map(m => m.canonical))].join(' | ')})`; return t;
  }
  const clubs = ms.filter(m => m.scope !== 'selecciones');
  const nations = ms.filter(m => m.scope === 'selecciones');
  let pick;
  if (clubs.length) {
    const distinct = new Set(clubs.map(m => m.canonical));
    if (distinct.size > 1) { t.verdict = 'review'; t.reason = `varios-equipos(${[...distinct].join(' | ')})`; return t; }
    pick = clubs[0];
  } else {
    const distinct = new Set(nations.map(m => m.canonical));
    if (distinct.size > 1) { t.verdict = 'review'; t.reason = `varias-selecciones(${[...distinct].join(' | ')})`; return t; }
    pick = nations[0];
  }

  t.team = pick.canonical;
  t.scope = CAT_OVERRIDE[pick.canonical] || pick.scope;   // cat de tienda (puede diferir del alcance)
  t.inScope = pick.scope !== 'out';
  t.residual = residualTokens(text, [pick]);

  if (!t.inScope) { t.reason = `fuera-de-alcance(${pick.canonical})`; return t; }

  const suspect = t.residual.filter(w => SUSPECT.has(w));
  if (suspect.length) { t.verdict = 'review'; t.reason = `equipo-dudoso(${pick.canonical}+${suspect.join(',')})`; return t; }

  t.verdict = 'include';
  t.reason = 'ok';
  return t;
}

function residualTokens(text, picks) {
  let s = ` ${text} `;
  for (const p of picks) s = s.replace(` ${p.alias} `, ' ');
  return s.split(' ').filter(w => w && !NOISE.has(w) && !/^\d+$/.test(w) && !/^\d?x{0,2}l$/.test(w) && !['s', 'm', 'xl', 'xxl'].includes(w));
}

// ─── Producto (mismo formato que data/products.json) ─────────────────────────
/** cats en el mismo orden que categorize.js: [liga | 'retro', liga, nuevatemporada, women, kids] */
function buildCats(t, rawTitle) {
  const league = t.scope; // laliga|premier|seriea|bundesliga|ligue1|europa|selecciones
  const cats = t.retro ? ['retro', league] : [league];
  if (NEW_SEASON_RE.test(rawTitle)) cats.push('nuevatemporada');
  if (t.women) cats.push('women');
  if (t.kids) cats.push('kids');
  return cats;
}

function buildProduct(t, { id, yupooUrl, prices }) {
  const cats = buildCats(t, t.title);
  const retro = cats.includes('retro');
  return {
    id: String(id),
    nameEs: t.title,
    nameEn: t.title,
    cats,
    type: retro ? 'retro' : 'normal',
    priceUsd: retro ? prices.retro : prices.normal,
    yupooCategory: t.scope,
    yupooUrl,
    img: null,
    photos: 0,
    sizes: detectSizes(t.title, t.kids),
    addedAt: Date.now(),
  };
}

// ─── Huella para detectar duplicados entre proveedores/ids ───────────────────
/**
 * Dos productos son "el mismo" si coinciden equipo, temporada y todos los
 * atributos. Los colores/descriptores solo cuentan en ediciones especiales
 * (en home/away/third el color es ruido).
 */
function fingerprint(t) {
  if (!t.team || !t.season || !t.inScope) return null;
  const plain = ['home', 'away', 'third', 'fourth'].includes(t.variant) && !t.special && !t.prematch;
  const parts = [
    t.team, t.season.label, t.variant || '-',
    t.kids ? 'K' : '', t.baby ? 'B' : '', t.crop ? 'C' : '', t.prematch ? 'PM' : '', t.specialTag, t.women ? 'W' : '', t.longSleeve ? 'L' : '', t.player ? 'P' : '', t.retro ? 'R' : '',
    plain ? '' : t.residual.slice().sort().join('+'),
  ];
  return parts.join('|');
}

module.exports = { norm, parseTitle, parseSeason, buildProduct, buildCats, fingerprint, detectSizes, isRetro, NEW_SEASON_RE };
