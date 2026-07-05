#!/usr/bin/env node
/**
 * upload-2627.mjs
 * Sube las imágenes WebP de "H:\26-27 v2" a Cloudflare R2 y genera
 * un fichero JSON con las entradas listas para products.json.
 *
 * Uso: node scripts/upload-2627.mjs
 */

import fs   from 'fs';
import path from 'path';
import crypto from 'crypto';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

// ─── Config ──────────────────────────────────────────────────────────────────
const SRC_DIR     = 'H:\\26-27 v2';
const R2_ENDPOINT = 'https://6600c8fee14f863b13c7b9bba8869364.r2.cloudflarestorage.com';
const R2_BUCKET   = 'pedimoscamis';
const KEY_PREFIX  = '26-27/';
const PUBLIC_BASE = 'https://pub-30dab6e51e0742a4bf695b05b150982a.r2.dev';
const OUT_JSON    = path.join('scripts', 'new-products-2627.json');

const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId:     '566df4f751d6f3d8ac1d94839f034bcd',
    secretAccessKey: '26e30e0384e4fff6678c8b32c1f266ac8868c89c231aa2d3165335156a4794da',
  },
});

// ─── Club → liga ─────────────────────────────────────────────────────────────
const CLUB_LEAGUE = {
  // Premier League
  'Arsenal': 'premier', 'Aston Villa': 'premier', 'Bournemouth': 'premier',
  'Brentford': 'premier', 'Brighton': 'premier', 'Chelsea': 'premier',
  'Crystal Palace': 'premier', 'Everton': 'premier', 'Fulham': 'premier',
  'Ipswich': 'premier', 'Leicester': 'premier', 'Liverpool': 'premier',
  'Manchester City': 'premier', 'Manchester United': 'premier',
  'Newcastle United': 'premier', 'Newcastle': 'premier',
  'Nottingham Forest': 'premier', 'Southampton': 'premier',
  'Tottenham': 'premier', 'West Ham': 'premier',
  'Wolverhampton': 'premier', 'Wolves': 'premier',
  // La Liga
  'Alaves': 'laliga', 'Athletic Club': 'laliga', 'Athletic Bilbao': 'laliga',
  'Athletic': 'laliga', 'Atletico Madrid': 'laliga', 'Barcelona': 'laliga',
  'Barca': 'laliga', 'Real Betis': 'laliga', 'Betis': 'laliga',
  'Celta Vigo': 'laliga', 'Celta': 'laliga', 'Espanyol': 'laliga',
  'Getafe': 'laliga', 'Girona': 'laliga', 'Las Palmas': 'laliga',
  'Leganes': 'laliga', 'Mallorca': 'laliga', 'Osasuna': 'laliga',
  'Rayo Vallecano': 'laliga', 'Rayo': 'laliga', 'Real Madrid': 'laliga',
  'Real Sociedad': 'laliga', 'Sevilla': 'laliga', 'Valencia': 'laliga',
  'Valladolid': 'laliga', 'Villarreal': 'laliga',
  // Serie A
  'Atalanta': 'seriea', 'Bologna': 'seriea', 'Cagliari': 'seriea',
  'Como': 'seriea', 'Empoli': 'seriea', 'Fiorentina': 'seriea',
  'Genoa': 'seriea', 'Inter Milan': 'seriea', 'Inter': 'seriea',
  'Juventus': 'seriea', 'Juve': 'seriea', 'Lazio': 'seriea',
  'Lecce': 'seriea', 'AC Milan': 'seriea', 'Milan': 'seriea',
  'Monza': 'seriea', 'Napoli': 'seriea', 'Parma': 'seriea',
  'Roma': 'seriea', 'Torino': 'seriea', 'Udinese': 'seriea',
  'Venezia': 'seriea', 'Verona': 'seriea',
  // Bundesliga
  'Augsburg': 'bundesliga', 'Bayer Leverkusen': 'bundesliga',
  'Bayern Munich': 'bundesliga', 'Bayern': 'bundesliga',
  'Bochum': 'bundesliga', 'Borussia Dortmund': 'bundesliga',
  'Dortmund': 'bundesliga', 'Eintracht Frankfurt': 'bundesliga',
  'Freiburg': 'bundesliga', 'Heidenheim': 'bundesliga',
  'Hoffenheim': 'bundesliga', 'Holstein Kiel': 'bundesliga',
  'RB Leipzig': 'bundesliga', 'Leipzig': 'bundesliga',
  'Mainz': 'bundesliga', 'St. Pauli': 'bundesliga', 'St Pauli': 'bundesliga',
  'Stuttgart': 'bundesliga', 'Union Berlin': 'bundesliga',
  'Werder Bremen': 'bundesliga', 'Wolfsburg': 'bundesliga',
  // Ligue 1
  'Angers': 'ligue1', 'Auxerre': 'ligue1', 'Brest': 'ligue1',
  'Havre': 'ligue1', 'Lens': 'ligue1', 'Lille': 'ligue1',
  'Lyon': 'ligue1', 'Marseille': 'ligue1', 'Monaco': 'ligue1',
  'Montpellier': 'ligue1', 'Nantes': 'ligue1', 'Nice': 'ligue1',
  'Paris Saint-Germain': 'ligue1', 'PSG': 'ligue1', 'Paris': 'ligue1',
  'Reims': 'ligue1', 'Rennes': 'ligue1', 'Saint-Etienne': 'ligue1',
  'Strasbourg': 'ligue1', 'Toulouse': 'ligue1',
};

// Ordenado por longitud desc para match más específico primero
const CLUBS_SORTED = Object.keys(CLUB_LEAGUE).sort((a, b) => b.length - a.length);

// ─── Parseo de nombre de álbum ────────────────────────────────────────────────
function parseAlbum(base) {
  let s = base;

  // Quitar prefijo de temporada
  s = s.replace(/^26[-\/]27\s+/i, '').trim();

  // Quitar sufijo del proveedor
  s = s.replace(/\s*Cheap\s+Soccer\s+Jerseys\s*$/i, '').trim();
  s = s.replace(/\s*Soccer\s+Jerseys\s*$/i, '').trim();

  // Detectar atributos antes de eliminarlos
  const isPlayerVersion = /Player\s+Version/i.test(s);
  const isKids          = /\bKids\b/i.test(s);
  const isLongSleeve    = /Long\s+Sleeve/i.test(s);
  const isWomen         = /\bWomen\b/i.test(s);
  const isRetro         = /\bRetro\b/i.test(s);

  // Detectar texto especial (aniversarios, ediciones) para preservarlo en el nombre
  const anniversaryMatch = s.match(/\b(\d+(?:st|nd|rd|th)\s+Anniversary)\b/i);
  const extraTag = anniversaryMatch ? anniversaryMatch[1] : null;

  s = s.replace(/\s*Player\s+Version/i,                   '').trim();
  s = s.replace(/\s*\bKids\b/i,                           '').trim();
  s = s.replace(/\s*Long\s+Sleeve/i,                      '').trim();
  s = s.replace(/\s*\bWomen\b/i,                          '').trim();
  s = s.replace(/\s*\bRetro\b/i,                          '').trim();
  if (extraTag) s = s.replace(extraTag, '').trim();

  // Detectar variante (Goalkeeper antes de Home para match más específico)
  const VARIANTS = ['Goalkeeper', 'Home', 'Away', 'Third', 'Fourth'];
  let variant = null;
  for (const v of VARIANTS) {
    const re = new RegExp(`\\s*\\b${v}\\b`, 'i');
    if (re.test(s)) {
      variant = v;
      s = s.replace(re, '').trim();
      break;
    }
  }

  const club = s.trim();

  // Encontrar liga — match exacto primero, luego parcial
  let league = null;
  for (const c of CLUBS_SORTED) {
    if (club.toLowerCase() === c.toLowerCase()) { league = CLUB_LEAGUE[c]; break; }
  }
  if (!league) {
    for (const c of CLUBS_SORTED) {
      if (club.toLowerCase().includes(c.toLowerCase())) { league = CLUB_LEAGUE[c]; break; }
    }
  }

  return { club, variant, isPlayerVersion, isKids, isLongSleeve, isWomen, isRetro, extraTag, league };
}

// ─── Generar nombres del producto ─────────────────────────────────────────────
const VARIANT_ES = { Home: 'Local', Away: 'Visitante', Third: 'Tercera', Fourth: 'Cuarta', Goalkeeper: 'Portero' };

function buildNames({ club, variant, isPlayerVersion, isKids, isLongSleeve, isWomen, isRetro, extraTag }) {
  const varEs = variant ? (VARIANT_ES[variant] ?? variant) : null;

  const suffixEs = [];
  const suffixEn = [];

  if (extraTag)         { suffixEs.push(extraTag);        suffixEn.push(extraTag); }
  if (isRetro)          { suffixEs.push('Retro');         suffixEn.push('Retro'); }
  if (isPlayerVersion)  { suffixEs.push('Player Version');suffixEn.push('Player Version'); }
  if (isKids)           { suffixEs.push('Infantil');      suffixEn.push('Kids'); }
  if (isLongSleeve)     { suffixEs.push('Manga Larga');   suffixEn.push('Long Sleeve'); }
  if (isWomen)          { suffixEs.push('Femenina');      suffixEn.push('Women'); }

  suffixEs.push('26/27');
  suffixEn.push('26/27');

  const nameEs = [club, varEs,   ...suffixEs].filter(Boolean).join(' ');
  const nameEn = [club, variant, ...suffixEn].filter(Boolean).join(' ');

  return { nameEs, nameEn };
}

// ─── R2 helpers ───────────────────────────────────────────────────────────────
function toKey(filename) {
  // Reemplaza espacios por guiones para URLs limpias
  return KEY_PREFIX + filename.replace(/\s+/g, '-');
}

async function exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch { return false; }
}

async function upload(localPath, key) {
  const body = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key,
    Body: body,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const allFiles = fs.readdirSync(SRC_DIR).filter(f => f.toLowerCase().endsWith('.webp'));

  // Agrupar por álbum base
  // El regex maneja tanto _resultado.webp como _resultado_1.webp, _resultado_2.webp
  const albums = new Map();
  for (const f of allFiles) {
    const base = f.replace(/\s*\(\d+\)_resultado(?:_\d+)?\.webp$/i, '').trim();
    const num  = parseInt(f.match(/\((\d+)\)/)?.[1] ?? '0');
    const isSuffix = /_resultado_\d+\.webp$/i.test(f); // variante _1, _2...

    if (!albums.has(base)) albums.set(base, new Map());
    const photoMap = albums.get(base);
    // Para un mismo número de foto, preferir _resultado.webp sobre _resultado_N.webp
    if (!photoMap.has(num) || (!isSuffix && photoMap.get(num).isSuffix)) {
      photoMap.set(num, { filename: f, isSuffix });
    }
  }

  // Convertir a arrays ordenados por número de foto
  const albumsSorted = new Map();
  for (const [base, photoMap] of albums) {
    const sorted = [...photoMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, v]) => v.filename);
    albumsSorted.set(base, sorted);
  }

  const newProducts = [];
  let nUploaded = 0, nSkipped = 0, nNoLeague = 0;

  console.log(`\n📦 ${albumsSorted.size} álbumes · ${allFiles.length} imágenes\n`);

  let idx = 0;
  for (const [base, photos] of albumsSorted) {
    idx++;
    const parsed  = parseAlbum(base);
    const { nameEs, nameEn } = buildNames(parsed);

    // cats: [liga, 'nuevatemporada'] + extras
    const cats = ['nuevatemporada'];
    if (parsed.league)   cats.unshift(parsed.league);
    else                 nNoLeague++;
    if (parsed.isRetro)  cats.push('retro');

    const imgUrls = [];

    for (const photo of photos) {
      const key      = toKey(photo);
      const publicUrl = `${PUBLIC_BASE}/${key}`;
      imgUrls.push(publicUrl);

      const localPath = path.join(SRC_DIR, photo);
      if (await exists(key)) {
        process.stdout.write(`  ⏭  ${photo}\n`);
        nSkipped++;
      } else {
        await upload(localPath, key);
        process.stdout.write(`  📤 ${photo}\n`);
        nUploaded++;
      }
    }

    // ID estable basado en hash del nombre base
    const id = 'jx' + crypto.createHash('md5').update(base).digest('hex').slice(0, 10);

    const product = {
      id,
      nameEs,
      nameEn,
      cats,
      type: 'normal',
      priceUsd: parsed.isPlayerVersion ? 20 : 15,
      yupooCategory: null,
      yupooUrl: '',
      img: imgUrls[0] ?? null,
      photos: photos.length,
      sizes: parsed.isKids
        ? ['4', '6', '8', '10', '12', '14', '16']
        : ['S', 'M', 'L', 'XL', '2XL', '3XL'],
      ...(imgUrls.length > 1 ? { gallery: imgUrls.slice(1) } : {}),
    };

    newProducts.push(product);
    const leagueTag = parsed.league ? `[${parsed.league}]` : '[⚠️ sin liga]';
    console.log(`  ✅ [${idx}/${albums.size}] ${nameEn} ${leagueTag}\n`);
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(newProducts, null, 2), 'utf-8');

  console.log('─'.repeat(60));
  console.log(`📤 Subidas:   ${nUploaded}`);
  console.log(`⏭  Ya en R2:  ${nSkipped}`);
  console.log(`⚠️  Sin liga:  ${nNoLeague}`);
  console.log(`📄 Productos: ${newProducts.length}`);
  console.log(`📁 JSON:      ${OUT_JSON}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
