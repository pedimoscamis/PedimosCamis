#!/usr/bin/env node
/**
 * download-2627.mjs
 * Descarga las 3 primeras fotos (big.jpeg) de cada álbum de jerseyxie que cumpla los filtros 26/27.
 * Uso: node scripts/download-2627.mjs
 */

import fs   from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

const YUPOO_BASE = 'https://jerseyxie.x.yupoo.com';
const LIST_BASE  = `${YUPOO_BASE}/albums?tab=gallery`;
const OUT_DIR    = 'H:\\26-27';
const MAX_IMG    = 3;
const DELAY_MS   = 800;

// ─── Filtros ────────────────────────────────────────────────────────────────
const SEASON_RE  = /26[-\/]27/i;
const EXCLUDE_RE = /windbraker|windbreaker|training|trainng|special|tracksuit|track\s+suit|jacket|shorts?|polo|hoodie|vest|sweatshirt|pants|socks|cap\b/i;

const TEAMS = [
  // Premier League
  'Arsenal','Aston Villa','Bournemouth','Brentford','Brighton','Chelsea',
  'Crystal Palace','Everton','Fulham','Ipswich','Leicester','Liverpool',
  'Manchester City','Man City','Manchester United','Man Utd','Newcastle',
  'Nottingham Forest','Southampton','Tottenham','Spurs','West Ham','Wolves',
  // La Liga
  'Alaves','Athletic Club','Atletico Madrid','Barcelona','Barca','Betis',
  'Celta Vigo','Espanyol','Getafe','Girona','Las Palmas','Leganes','Mallorca',
  'Osasuna','Rayo Vallecano','Real Madrid','Real Sociedad','Sevilla','Valencia',
  'Valladolid','Villarreal',
  // Serie A
  'Atalanta','Bologna','Cagliari','Como','Empoli','Fiorentina','Genoa','Inter',
  'Juventus','Juve','Lazio','Lecce','Milan','Monza','Napoli','Parma','Roma',
  'Torino','Udinese','Venezia','Verona',
  // Bundesliga
  'Augsburg','Bayer Leverkusen','Bayern Munich','Bochum','Borussia Dortmund',
  'Dortmund','Borussia Monchengladbach','Eintracht Frankfurt','Freiburg',
  'Heidenheim','Hoffenheim','Holstein Kiel','RB Leipzig','Leipzig','Mainz',
  'St. Pauli','Stuttgart','Union Berlin','Werder Bremen','Wolfsburg',
  // Ligue 1
  'Angers','Auxerre','Brest','Havre','Lens','Lille','Lyon','Marseille',
  'Monaco','Montpellier','Nantes','Nice','PSG','Paris Saint-Germain',
  'Reims','Rennes','Saint-Etienne','Strasbourg','Toulouse',
];

function qualifies(title) {
  if (!SEASON_RE.test(title))  return false;
  if (EXCLUDE_RE.test(title))  return false;
  const tl = title.toLowerCase();
  return TEAMS.some(t => tl.includes(t.toLowerCase()));
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────
const HEADERS = {
  'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  'Accept'         : 'text/html,application/xhtml+xml,*/*;q=0.9',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer'        : 'https://jerseyxie.x.yupoo.com/',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} → ${url}`);
  return res.text();
}

// ─── Parseo de la lista de álbumes ───────────────────────────────────────────
// HTML del listado tiene: title="…" href="/albums/ID?uid=1"
function parseAlbumList(html) {
  const albums = [];
  const seen   = new Set();

  const re = /title="([^"]+)"\s+href="(\/albums\/(\d+)[^"]*)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, title, href, id] = m;
    if (!seen.has(id)) {
      seen.add(id);
      albums.push({ id, title: title.trim(), href });
    }
  }
  return albums;
}

function hasNextPage(html) {
  return /rel=["']next["']|class="[^"]*next[^"]*"/.test(html);
}

// ─── Parseo de fotos de un álbum ─────────────────────────────────────────────
// Las URLs reales aparecen como: photo.yupoo.com/jerseyxie/{id}/big.jpeg
// Preferencia: big > large > medium (descartamos small, sq, th)
const SIZE_RANK = { big: 4, large: 3, xl: 3, xxl: 3, medium: 2, m: 2, small: 1, sq: 0, th: 0 };

function parsePhotos(html) {
  const byId = {};   // photoId → { urls, bestSize }

  const re = /photo\.yupoo\.com\/jerseyxie\/([a-zA-Z0-9]+)\/([a-zA-Z0-9]+)\.([a-z]+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [full, photoId, sizeName, ext] = m;
    const rank = SIZE_RANK[sizeName.toLowerCase()] ?? 1;
    if (!byId[photoId] || rank > byId[photoId].rank) {
      byId[photoId] = { url: `https://photo.yupoo.com/jerseyxie/${photoId}/${sizeName}.${ext}`, rank };
    }
  }

  // Filtrar miniaturas (rank ≤ 0) y ordenar por orden de aparición
  return Object.values(byId)
    .filter(v => v.rank > 0)
    .map(v => v.url);
}

// ─── Descarga ─────────────────────────────────────────────────────────────────
async function downloadFile(url, dest) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
}

function safeFilename(title) {
  // Elimina "Yupoo" del final (nombre genérico que añade el proveedor)
  return title
    .replace(/\s*yupoo\s*$/i, '')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function extFromUrl(url) {
  const m = url.match(/\.(jpg|jpeg|webp|png)$/i);
  return m ? `.${m[1].toLowerCase()}` : '.jpg';
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });

  let page        = 1;
  let totalAlbums = 0;
  let totalImgs   = 0;
  const processed = new Set();

  console.log('🔍 Escaneando catálogo 26/27 en jerseyxie.x.yupoo.com…\n');

  while (true) {
    const listUrl = `${LIST_BASE}&page=${page}`;
    console.log(`📄 Página ${page}: ${listUrl}`);

    let listHtml;
    try {
      listHtml = await fetchText(listUrl);
    } catch (e) {
      console.error(`   ❌ Error: ${e.message}`);
      break;
    }

    const albums = parseAlbumList(listHtml);
    console.log(`   → ${albums.length} álbumes en esta página`);

    if (albums.length === 0) { console.log('   → Sin más álbumes.'); break; }

    for (const album of albums) {
      if (processed.has(album.id)) continue;
      processed.add(album.id);

      if (!qualifies(album.title)) {
        console.log(`   ⏭  SKIP  | ${album.title}`);
        continue;
      }

      console.log(`\n   ✅ MATCH | ${album.title}`);
      totalAlbums++;

      await sleep(DELAY_MS);

      // Usar el href original que ya incluye ?uid=1
      const albumUrl = `${YUPOO_BASE}${album.href}`;
      let albumHtml;
      try {
        albumHtml = await fetchText(albumUrl);
      } catch (e) {
        console.error(`      ❌ Error al obtener álbum: ${e.message}`);
        continue;
      }

      const photos = parsePhotos(albumHtml);
      if (photos.length === 0) {
        console.log('      ⚠️  Sin imágenes detectadas.');
        continue;
      }

      const slug = safeFilename(album.title);
      const take = photos.slice(0, MAX_IMG);

      for (let i = 0; i < take.length; i++) {
        const ext  = extFromUrl(take[i]);
        const dest = path.join(OUT_DIR, `${slug} (${i + 1})${ext}`);
        try {
          await downloadFile(take[i], dest);
          console.log(`      📥 ${i + 1}/${take.length} → ${path.basename(dest)}`);
          totalImgs++;
        } catch (e) {
          console.error(`      ❌ Error foto ${i + 1}: ${e.message}`);
        }
        await sleep(400);
      }
    }

    if (!hasNextPage(listHtml)) { console.log('\n✅ Sin más páginas.'); break; }
    page++;
    await sleep(DELAY_MS);
  }

  console.log(`\n🏁 Finalizado: ${totalAlbums} álbumes · ${totalImgs} imágenes → ${OUT_DIR}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
