/**
 * KitZone Scraper — por categorías de Yupoo
 *
 * En lugar de recorrer /albums?tab=gallery (lista global sin categoría),
 * recorre cada categoría de Yupoo individualmente y guarda el campo
 * yupooCategory en cada producto. El categorizador puede usarlo como
 * fuente fiable en vez de adivinar por el nombre del álbum.
 *
 * Flujo:
 *   Fase 1 — Para cada categoría: paginar /categories/ID?page=N
 *             hasta que la página devuelva 0 álbumes.
 *   Fase 2 — Para cada álbum nuevo: visitar su URL y extraer la imagen.
 *   Incremental: los álbumes ya en products-raw.json se omiten en Fase 1,
 *                pero si les faltaba yupooCategory se les actualiza.
 */

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// ─── Configuración ────────────────────────────────────────────────────────────

const BASE_URL = 'https://ggjersey.x.yupoo.com';
const DATA_DIR  = path.join(__dirname, 'data');
const RAW_FILE  = path.join(DATA_DIR, 'products-raw.json');

const DELAY_LISTING = 800;   // ms entre páginas de listado
const DELAY_ALBUM   = 600;   // ms entre visitas a álbumes individuales
const MAX_EMPTY_PAGES = 2;   // páginas consecutivas vacías antes de parar

// ─── Mapeo de categorías Yupoo → categoría KitZone ───────────────────────────
//
// Para añadir una categoría nueva:
//   1. Navega a ggjersey.x.yupoo.com y abre la categoría deseada.
//   2. Copia el ID numérico de la URL: /categories/XXXXXXX
//   3. Añade una entrada al array con ese ID y el nombre de cat de KitZone.
//
// Las categorías sin ID conocido llevan id: null y se omiten en el scraping.

const YUPOO_CATEGORIES = [
  // ── Ligas europeas principales ─────────────────────────────────────────
  { id: '5179820', label: 'LaLiga',              kitzoneCat: 'laliga'      },
  { id: '5179819', label: 'Premier League',      kitzoneCat: 'premier'     },
  { id: '5179818', label: 'Serie A',             kitzoneCat: 'seriea'      },
  { id: '5179817', label: 'Bundesliga',          kitzoneCat: 'bundesliga'  },
  { id: '5179798', label: 'Ligue 1',             kitzoneCat: 'ligue1'      },
  { id: '5179796', label: 'Scottish League',     kitzoneCat: 'premier'     }, // Celtic, Rangers
  { id: '5179805', label: 'Portuguesa',          kitzoneCat: 'europa'      }, // Porto, Benfica, Sporting
  { id: '5179804', label: 'Eredivisie',          kitzoneCat: 'europa'      }, // Ajax, PSV
  // ── Selecciones y sudamérica ───────────────────────────────────────────
  { id: '5179813', label: 'Selecciones',         kitzoneCat: 'selecciones' },
  { id: '5179815', label: 'Brasileirão',         kitzoneCat: 'sudamerica'  },
  { id: '5179807', label: 'Liga Argentina (SAF)',kitzoneCat: 'sudamerica'  },
  { id: '5179809', label: 'Liga MX',             kitzoneCat: 'sudamerica'  },
  { id: '5179810', label: 'Liga Chilena',        kitzoneCat: 'sudamerica'  },
  { id: '5179797', label: 'MLS',                 kitzoneCat: 'sudamerica'  },
  // ── Tipo de producto ───────────────────────────────────────────────────
  { id: '5179808', label: 'Retro',               kitzoneCat: 'retro'       },
  { id: '5179791', label: 'NBA',                 kitzoneCat: 'nba'         },
  { id: '5179790', label: 'NFL',                 kitzoneCat: 'nfl'         },
  // Streetwear: 5 subcategorías (Gallery Dept, BAPE, AMIRI, etc.)
  { id: '5179781', label: 'Streetwear A',        kitzoneCat: 'streetwear'  },
  { id: '5179775', label: 'Streetwear B',        kitzoneCat: 'streetwear'  },
  { id: '5179769', label: 'Streetwear C',        kitzoneCat: 'streetwear'  },
  { id: '5179768', label: 'Streetwear D',        kitzoneCat: 'streetwear'  },
  { id: '5179767', label: 'Streetwear E',        kitzoneCat: 'streetwear'  },
  { id: '5179802', label: 'Windbreaker',         kitzoneCat: 'windbreaker' },
  { id: '5179800', label: 'Kids',                kitzoneCat: 'kids'        },
  { id: '5179801', label: 'Women',               kitzoneCat: 'women'       },
];

// Categorías con ID configurado (las que realmente se scrapean)
const ACTIVE_CATEGORIES = YUPOO_CATEGORIES.filter(c => c.id !== null);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadExisting() {
  if (!fs.existsSync(RAW_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(RAW_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveProducts(products) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RAW_FILE, JSON.stringify(products, null, 2), 'utf-8');
}

async function fetchPage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Connection': 'keep-alive',
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

// ─── Extracción de álbumes de una página de categoría ────────────────────────

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

  // Selector principal
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

  // Fallback: bloques con clase album
  if (albums.length === 0) {
    $('[class*="album"]').each((_, el) => {
      const link = $(el).find('a[href*="/albums/"]').first();
      const href = link.attr('href') || '';
      const match = href.match(/\/albums\/(\d+)/);
      if (!match) return;
      const name = (
        $(el).find('[class*="title"],[class*="name"]').first().text() ||
        link.attr('title') ||
        link.find('img').attr('alt')
      ).trim();
      tryAdd(match[1], name, href);
    });
  }

  return albums;
}

async function fetchCategoryPage(categoryId, page) {
  const url = `${BASE_URL}/categories/${categoryId}?page=${page}`;
  const html = await fetchPage(url);
  if (!html) return [];
  return parseAlbumsFromHtml(html);
}

// ─── Extracción de imagen principal de un álbum ───────────────────────────────

async function fetchAlbumImage(albumUrl) {
  const html = await fetchPage(albumUrl);
  if (!html) return { img: null, photos: 0 };

  const $ = cheerio.load(html);
  let imgUrl = null;

  const allImgs = $(
    'img[src*="photo.yupoo.com"], img[src*="img.yupoo.com"],' +
    'img[data-src*="photo.yupoo.com"], img[data-src*="img.yupoo.com"]'
  );
  const photos = allImgs.length;

  const first = allImgs.first();
  imgUrl = first.attr('src') || first.attr('data-src') || null;

  if (!imgUrl) {
    $('img').each((_, el) => {
      if (imgUrl) return;
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (src.includes('photo.yupoo.com') || src.includes('img.yupoo.com')) {
        imgUrl = src;
      }
    });
  }

  if (imgUrl) {
    imgUrl = imgUrl.split('?')[0];
    imgUrl = imgUrl.replace(
      /\/(small|medium|large|huge|square|thumb)\.(jpg|jpeg|png|webp)$/i,
      '/small.jpg'
    );
  }

  return { img: imgUrl, photos };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== KitZone Scraper (por categorías) ===');
  console.log(`Fecha: ${new Date().toISOString()}`);
  console.log(`Categorías activas: ${ACTIVE_CATEGORIES.length} / ${YUPOO_CATEGORIES.length} configuradas`);

  if (ACTIVE_CATEGORIES.length === 0) {
    console.error('\n⚠️  No hay categorías con ID configurado en YUPOO_CATEGORIES.');
    console.error('   Añade los IDs de categoría de Yupoo y vuelve a ejecutar.');
    process.exit(1);
  }

  // ── Cargar estado existente ──────────────────────────────────────────────
  const existing = loadExisting();
  const existingMap = new Map(existing.map(p => [p.id, p]));
  console.log(`\nProductos en caché: ${existing.length}`);

  // ── FASE 1: Recorrer categorías y recopilar álbumes nuevos ───────────────
  console.log('\n── Fase 1: Listado de álbumes por categoría ──────────────────');

  // Álbumes nuevos a enriquecer con imagen
  const toEnrich = [];
  // Actualizaciones de yupooCategory para productos ya existentes
  const categoryUpdates = new Map(); // id → kitzoneCat

  for (const cat of ACTIVE_CATEGORIES) {
    console.log(`\n  📂 ${cat.label} (ID: ${cat.id})`);
    let page = 1;
    let emptyStreak = 0;
    let catTotal = 0;
    let catNew = 0;

    while (emptyStreak < MAX_EMPTY_PAGES) {
      process.stdout.write(`    Página ${page}... `);
      const albums = await fetchCategoryPage(cat.id, page);

      if (albums.length === 0) {
        emptyStreak++;
        console.log(`vacía (${emptyStreak}/${MAX_EMPTY_PAGES})`);
      } else {
        emptyStreak = 0;
        catTotal += albums.length;

        for (const album of albums) {
          if (existingMap.has(album.id)) {
            // Producto ya conocido: actualizar categoría si faltaba
            const existing = existingMap.get(album.id);
            if (!existing.yupooCategory) {
              categoryUpdates.set(album.id, cat.kitzoneCat);
            }
          } else {
            toEnrich.push({ ...album, yupooCategory: cat.kitzoneCat });
            catNew++;
          }
        }
        console.log(`${albums.length} álbumes (${catNew} nuevos acum.)`);
      }

      page++;
      await sleep(DELAY_LISTING);
    }

    console.log(`  ✓ ${cat.label}: ${catTotal} álbumes encontrados, ${catNew} nuevos`);
  }

  // Aplicar actualizaciones de categoría a productos existentes
  if (categoryUpdates.size > 0) {
    console.log(`\nActualizando yupooCategory en ${categoryUpdates.size} productos existentes...`);
    for (const p of existing) {
      if (categoryUpdates.has(p.id)) {
        p.yupooCategory = categoryUpdates.get(p.id);
      }
    }
  }

  // Deduplicar toEnrich (un mismo álbum puede aparecer en varias categorías Yupoo)
  const seenNew = new Set();
  const uniqueNew = toEnrich.filter(a => {
    if (seenNew.has(a.id)) return false;
    seenNew.add(a.id);
    return true;
  });

  console.log(`\nNuevos álbumes únicos a procesar: ${uniqueNew.length}`);
  console.log(`Actualizaciones de categoría aplicadas: ${categoryUpdates.size}`);

  if (uniqueNew.length === 0 && categoryUpdates.size === 0) {
    console.log('No hay cambios. Catálogo actualizado.');
    // Guardar igualmente si hubo actualizaciones de categoría
    saveProducts(existing);
    return;
  }

  // ── FASE 2: Extraer imagen principal de cada álbum nuevo ─────────────────
  console.log('\n── Fase 2: Extrayendo imágenes ───────────────────────────────');
  const enriched = [];

  for (let i = 0; i < uniqueNew.length; i++) {
    const album = uniqueNew[i];
    process.stdout.write(
      `  [${i + 1}/${uniqueNew.length}] [${album.yupooCategory}] ${album.name.substring(0, 55)}... `
    );

    const { img, photos } = await fetchAlbumImage(album.yupooUrl);
    enriched.push({
      id:           album.id,
      name:         album.name,
      yupooCategory: album.yupooCategory,
      yupooUrl:     album.yupooUrl,
      img:          img,
      photos:       photos,
    });

    console.log(img ? `OK (${photos} fotos)` : 'Sin imagen');
    await sleep(DELAY_ALBUM);

    // Checkpoint cada 50 productos
    if ((i + 1) % 50 === 0) {
      const snapshot = [...existing, ...enriched];
      saveProducts(snapshot);
      console.log(`  >> Checkpoint: ${snapshot.length} productos totales`);
    }
  }

  // ── Fusionar y guardar ───────────────────────────────────────────────────
  const merged = [...existing, ...enriched];
  saveProducts(merged);

  console.log('\n=== Scraping completado ===');
  console.log(`Productos totales:     ${merged.length}`);
  console.log(`Nuevos añadidos:       ${enriched.length}`);
  console.log(`Categorías sin ID:     ${YUPOO_CATEGORIES.filter(c => !c.id).map(c => c.label).join(', ') || 'ninguna'}`);
  console.log(`Archivo: ${RAW_FILE}`);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
