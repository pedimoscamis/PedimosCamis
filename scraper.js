/**
 * KitZone Scraper
 * Extrae el catálogo completo de ggjersey.x.yupoo.com
 * Soporta actualización incremental: solo procesa álbumes nuevos.
 */

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://ggjersey.x.yupoo.com';
const ALBUMS_URL = `${BASE_URL}/albums`;
const TOTAL_PAGES = 127;
const DATA_DIR = path.join(__dirname, 'data');
const RAW_FILE = path.join(DATA_DIR, 'products-raw.json');

const DELAY_LISTING = 800;
const DELAY_ALBUM = 600;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadExisting() {
  if (!fs.existsSync(RAW_FILE)) return [];
  try {
    const raw = fs.readFileSync(RAW_FILE, 'utf-8');
    return JSON.parse(raw);
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

async function fetchAlbumList(page) {
  const url = `${ALBUMS_URL}?tab=gallery&page=${page}`;
  const html = await fetchPage(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  const albums = [];

  // Selector: contenedor de álbumes en la galería de Yupoo
  $('a.album__main, a[href*="/albums/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/\/albums\/(\d+)/);
    if (!match) return;

    const id = match[1];
    const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;

    // Nombre del álbum: buscar en title, alt, o texto del enlace
    let name = $(el).attr('title')
      || $(el).find('img').attr('alt')
      || $(el).find('.album__title, .album__name, [class*="title"]').text()
      || '';
    name = name.trim();

    if (id && name) {
      albums.push({ id, name, yupooUrl: fullUrl });
    }
  });

  // Fallback: buscar estructura alternativa de Yupoo
  if (albums.length === 0) {
    $('[class*="album"]').each((_, el) => {
      const link = $(el).find('a[href*="/albums/"]').first();
      const href = link.attr('href') || '';
      const match = href.match(/\/albums\/(\d+)/);
      if (!match) return;

      const id = match[1];
      const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
      const name = (
        $(el).find('[class*="title"], [class*="name"]').first().text()
        || link.attr('title')
        || link.find('img').attr('alt')
        || ''
      ).trim();

      if (id && name) {
        albums.push({ id, name, yupooUrl: fullUrl });
      }
    });
  }

  return albums;
}

async function fetchAlbumImage(albumUrl) {
  const html = await fetchPage(albumUrl);
  if (!html) return { img: null, photos: 0 };

  const $ = cheerio.load(html);
  let imgUrl = null;
  let photos = 0;

  // Contar imágenes totales
  const allImgs = $('img[src*="photo.yupoo.com"], img[src*="img.yupoo.com"], img[data-src*="photo.yupoo.com"], img[data-src*="img.yupoo.com"]');
  photos = allImgs.length;

  // Primera imagen del álbum
  const firstImg = allImgs.first();
  imgUrl = firstImg.attr('src') || firstImg.attr('data-src') || null;

  // Fallback: buscar cualquier imagen que coincida con patrones de Yupoo
  if (!imgUrl) {
    $('img').each((_, el) => {
      if (imgUrl) return;
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (src.includes('photo.yupoo.com') || src.includes('img.yupoo.com')) {
        imgUrl = src;
        photos = photos || 1;
      }
    });
  }

  // Limpiar URL (quitar parámetros de tamaño y forzar medium)
  if (imgUrl) {
    imgUrl = imgUrl.split('?')[0];
    // Normalizar a medium si tiene sufijo de tamaño conocido
    imgUrl = imgUrl.replace(/\/(small|large|huge|square|thumb)\.(jpg|jpeg|png|webp)$/i, '/medium.$2');
  }

  return { img: imgUrl, photos };
}

async function main() {
  console.log('=== KitZone Scraper ===');
  console.log(`Fecha: ${new Date().toISOString()}`);

  // Cargar productos existentes
  const existing = loadExisting();
  const existingIds = new Set(existing.map(p => p.id));
  console.log(`Productos existentes en caché: ${existing.length}`);

  const newAlbums = [];

  // FASE 1: Recorrer páginas del listado
  console.log(`\nFase 1: Recorriendo ${TOTAL_PAGES} páginas de álbumes...`);
  for (let page = 1; page <= TOTAL_PAGES; page++) {
    process.stdout.write(`  Página ${page}/${TOTAL_PAGES}... `);
    const albums = await fetchAlbumList(page);

    let newCount = 0;
    for (const album of albums) {
      if (!existingIds.has(album.id)) {
        newAlbums.push(album);
        newCount++;
      }
    }
    console.log(`${albums.length} álbumes encontrados, ${newCount} nuevos`);
    await sleep(DELAY_LISTING);
  }

  console.log(`\nNuevos álbumes a procesar: ${newAlbums.length}`);

  if (newAlbums.length === 0) {
    console.log('No hay productos nuevos. Catálogo actualizado.');
    return;
  }

  // FASE 2: Extraer imagen principal de cada álbum nuevo
  console.log('\nFase 2: Extrayendo imágenes de álbumes nuevos...');
  const enriched = [];

  for (let i = 0; i < newAlbums.length; i++) {
    const album = newAlbums[i];
    process.stdout.write(`  [${i + 1}/${newAlbums.length}] ${album.name.substring(0, 60)}... `);

    const { img, photos } = await fetchAlbumImage(album.yupooUrl);
    enriched.push({
      id: album.id,
      name: album.name,
      yupooUrl: album.yupooUrl,
      img: img,
      photos: photos,
    });

    console.log(img ? `OK (${photos} fotos)` : 'Sin imagen');
    await sleep(DELAY_ALBUM);

    // Guardar checkpoint cada 50 productos
    if ((i + 1) % 50 === 0) {
      const merged = [...existing, ...enriched];
      saveProducts(merged);
      console.log(`  >> Checkpoint guardado (${merged.length} productos totales)`);
    }
  }

  // Fusionar y guardar
  const merged = [...existing, ...enriched];
  saveProducts(merged);

  console.log(`\n=== Scraping completado ===`);
  console.log(`Productos totales: ${merged.length}`);
  console.log(`Nuevos añadidos: ${enriched.length}`);
  console.log(`Archivo guardado: ${RAW_FILE}`);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
