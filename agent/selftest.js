'use strict';
/**
 * Autotest del parser contra el catálogo real (uso: node agent/selftest.js [--show N]).
 *
 * Oráculo: los productos ya catalogados. Para cada uno que el parser acepte
 * ('include') se compara liga/overlays con los cats que ya tiene en
 * products.json. Los desacuerdos se listan para revisarlos a mano: o el
 * parser está mal, o el catálogo antiguo lo estaba (categorize.js tiene
 * falsos positivos conocidos, p. ej. Celtic/Rangers como premier).
 */
const fs = require('fs');
const path = require('path');
const { parseTitle, buildCats } = require('./parse');

const show = (() => { const i = process.argv.indexOf('--show'); return i === -1 ? 25 : +process.argv[i + 1]; })();
const products = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'products.json'), 'utf8'));

const LEAGUES = new Set(['laliga', 'premier', 'seriea', 'bundesliga', 'ligue1', 'selecciones', 'europa', 'sudamerica', 'otros']);
const stats = { total: 0, include: 0, skip: 0, review: 0, agree: 0, leagueDiff: 0, overlayDiff: 0 };
const reasons = {};
const diffs = { league: [], overlay: [] };

for (const p of products) {
  stats.total++;
  const t = parseTitle(p.nameEn, { includeRetro: true, minSeasonStart: 1900 });
  stats[t.verdict]++;
  const key = t.verdict + ':' + t.reason.replace(/\(.*/, '');
  reasons[key] = (reasons[key] || 0) + 1;
  if (t.verdict !== 'include') continue;

  const mine = buildCats(t, t.title);
  const theirs = p.cats || [];
  const myLeague = mine.find(c => LEAGUES.has(c));
  const theirLeague = theirs.find(c => LEAGUES.has(c));
  const ov = c => ['retro', 'nuevatemporada', 'women', 'kids'].filter(x => c.includes(x)).sort().join();
  if (myLeague !== theirLeague) { stats.leagueDiff++; diffs.league.push([p.nameEn, 'mine=' + myLeague, 'cat=' + theirLeague]); }
  else if (ov(mine) !== ov(theirs)) { stats.overlayDiff++; diffs.overlay.push([p.nameEn, 'mine=' + ov(mine), 'cat=' + ov(theirs)]); }
  else stats.agree++;
}

console.log(stats);
console.log('\nMotivos (top):');
Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, v]) => console.log(' ', String(v).padStart(6), k));
for (const k of ['league', 'overlay']) {
  console.log(`\nDesacuerdos de ${k} (${diffs[k].length}, mostrando ${Math.min(show, diffs[k].length)}):`);
  diffs[k].slice(0, show).forEach(d => console.log('  ', d.join('  |  ')));
}

// ─── Casos fijos: títulos conflictivos con el resultado esperado ─────────────
// Si algo aquí falla tras tocar teams.js/parse.js, NO desplegar el agente.
const CASES = [
  // [título, verdict, cat-liga esperada | motivo (prefijo), cats completas opcional]
  ['2026/27 Barcelona x Golf Wang El Clasico Home Jersey S-4XL', 'include', 'laliga', 'laliga,nuevatemporada'],
  ['Women\'s 2026/27 Napoli Away Jersey S-XXL', 'include', 'seriea', 'seriea,nuevatemporada,women'],
  ['2026/27 Napoli Away Kids Kit 16-28', 'include', 'seriea', 'seriea,nuevatemporada,kids'],
  ['2026/27 Real Madrid Third Baby Jersey 9-12', 'include', 'laliga', 'laliga,nuevatemporada,kids'],
  ['2026/27 Chelsea Third Jersey Long Sleeve S-4XL', 'include', 'premier', 'premier,nuevatemporada'],
  ['2026/27 PSG Third Jersey Player Version Long Sleeve S-3XL', 'include', 'ligue1', 'ligue1,nuevatemporada'],
  ['2026/27 Croatia Away Kids Kits 16-28', 'include', 'selecciones', 'selecciones,nuevatemporada,kids'],
  ['2026 Argentina Messi Farewell Women\'s Jersey S-XXL', 'include', 'selecciones', 'selecciones,women'],
  ['2026/27 Bosnia & Herzegovina Away Jersey S-4XL', 'include', 'selecciones', 'selecciones,nuevatemporada'],
  ['2026/27 Sporting Lisbon Goalkeeper Grey Jersey S-4XL', 'include', 'europa', 'europa,nuevatemporada'],
  ['2026/27 Ajax Second Away Kids Kits 16-28', 'include', 'europa', 'europa,nuevatemporada,kids'],
  ['2026/27 Inter Milan Third kids Kits 16-28', 'include', 'seriea', 'seriea,nuevatemporada,kids'],
  ['2026/27 AC Milan Away Jersey S-4XL', 'include', 'seriea'],
  ['2026/27 Olympique Lyonnais Away Jersey Player Version S-3XL', 'include', 'ligue1'],
  ['2026/27 Newcastle United Home Jersey S-4XL', 'include', 'premier'],
  ['2026/27 Real Madrid Second Away Kids Kits 16-28', 'include', 'laliga', 'laliga,nuevatemporada,kids'],
  // fuera de alcance / no son camisetas / peligrosos
  ['2026/27 Inter Miami Home Jersey S-4XL', 'skip', 'fuera-de-alcance'],
  ['2026/27 Atletico Mineiro Third Kids Kits 16-28', 'skip', 'fuera-de-alcance'],
  ['2026/27 Flamengo Home Jersey S-4XL', 'skip', 'fuera-de-alcance'],
  ['2026/27 Barcelona SC Home Jersey S-4XL', 'skip', 'fuera-de-alcance'],
  ['2026/27 University of Chile Home Jersey S-4XL', 'skip', 'fuera-de-alcance'],
  ['2025/26 New England Revolution Away Jersey S-4XL', 'skip', 'fuera-de-alcance'],
  ['San Antonio Spurs 2026 Grey jersey FOX#4 S-XXL', 'skip', 'fuera-de-alcance'],
  ['Utah Jazz 2026 JORDAN Edition Black Jersey S-XXL', 'skip', 'fuera-de-alcance'],
  ['Retro 2012/13 Bayern Munich Home Jesrey S-XXL', 'include', 'bundesliga', 'retro,bundesliga'],
  ['Retro Atlas F.C. 1995/96 Home Jersey S-3XL', 'skip', 'fuera-de-alcance'],
  ['2026/27 Real Madrid Training Jersey S-4XL', 'skip', 'no-camiseta'],
  ['2026/27 Arsenal Windbreaker Jacket S-4XL', 'skip', 'no-camiseta'],
  ['2026/27 Barcelona Shorts S-XXL', 'skip', 'no-camiseta'],
  ['2027/28 Real Madrid Home Jersey Leaked Version S-3XL', 'skip', 'no-camiseta'],
  ['2023/24 Real Madrid Home Jersey S-XXL', 'include', 'laliga', 'laliga'],
  ['2026/27 Brazil Jordan Special Edition Red Jersey S-XXL', 'include', 'selecciones'],
  // dudosos: nunca entran, van a revisión
  ['2026/27 Uruguay Nacional Away Jersey S-XXL', 'review', 'equipo-dudoso'],
  ['2026/27 Sevilla Atletico Home Jersey S-4XL', 'review', 'equipo-dudoso'],
  ['2026/27 Zzyzx United Home Jersey S-4XL', 'review', 'equipo-desconocido'],
  ['Barcelona Home Jersey S-4XL', 'review', 'sin-temporada'],
  ['25/26 Barcelona/Inter Miami/PSG/Argentina Messi 10 Commemorative Edition jersey S-4XL', 'review', 'varios-equipos'],
];
let bad = 0;
for (const [title, verdict, expect, catsExpect] of CASES) {
  const t = parseTitle(title, {});
  const got = t.verdict === 'include' ? t.scope : t.reason;
  let ok = t.verdict === verdict && (verdict === 'include' ? t.scope === expect : t.reason.startsWith(expect));
  if (ok && catsExpect) ok = buildCats(t, t.title).join(',') === catsExpect;
  if (!ok) { bad++; console.log(`✗ ${title}\n    esperado ${verdict}/${expect}${catsExpect ? '/' + catsExpect : ''}  obtenido ${t.verdict}/${got}${t.verdict === 'include' ? '/' + buildCats(t, t.title).join(',') : ''}`); }
}
console.log(`\nCasos fijos: ${CASES.length - bad}/${CASES.length} correctos`);
if (bad) process.exitCode = 1;
