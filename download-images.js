/**
 * PedimosCamis? — Descargador de imágenes
 *
 * Lee products.json, descarga las imágenes de las categorías principales
 * a la carpeta images/ y actualiza products.json para apuntar a los
 * archivos locales en lugar de las URLs de Yupoo.
 *
 * Uso: node download-images.js
 *
 * Incremental: si images/ID.jpg ya existe lo omite y actualiza el JSON
 * directamente sin volver a descargar.
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ─── Configuración ────────────────────────────────────────────────────────────

const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const IMAGES_DIR    = path.join(__dirname, 'images');
const DELAY_MS      = 400;

const TARGET_CATS = new Set(['laliga', 'premier', 'seriea', 'bundesliga', 'ligue1', 'selecciones']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function downloadFile(url, destPath, retries = 3) {
  return new Promise((resolve, reject) => {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    let parsed;
    try { parsed = new URL(fullUrl); } catch { return reject(new Error('URL inválida')); }

    const attempt = (n) => {
      const transport = parsed.protocol === 'https:' ? https : http;
      const req = transport.request(
        { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/webp,image/avif,image/*,*/*;q=0.8',
            'Referer': 'https://www.yupoo.com/',
          },
        },
        (res) => {
          // Seguir redirecciones
          if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            const loc = res.headers['location'];
            if (loc) { res.resume(); parsed = new URL(loc); return attempt(n); }
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          const file = fs.createWriteStream(destPath);
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
          file.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
        }
      );
      req.on('error', (err) => {
        if (n < retries) { setTimeout(() => attempt(n + 1), 1000 * n); }
        else reject(err);
      });
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    };
    attempt(1);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== PedimosCamis? Descargador de imágenes ===');

  if (!fs.existsSync(PRODUCTS_FILE)) {
    console.error('Error: data/products.json no encontrado. Ejecuta node categorize.js primero.');
    process.exit(1);
  }

  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));

  const targets = products.filter(p =>
    TARGET_CATS.has(p.cat) && p.img && !p.img.startsWith('/images/')
  );
  const alreadyLocal = products.filter(p =>
    TARGET_CATS.has(p.cat) && p.img && p.img.startsWith('/images/')
  ).length;

  console.log(`Productos en categorías objetivo: ${products.filter(p => TARGET_CATS.has(p.cat)).length}`);
  console.log(`Ya descargados (omitidos):        ${alreadyLocal}`);
  console.log(`Pendientes de descargar:          ${targets.length}`);
  console.log(`Carpeta destino:                  ${IMAGES_DIR}\n`);

  if (targets.length === 0) {
    console.log('Nada que descargar. products.json ya está actualizado.');
    return;
  }

  let ok = 0, skipped = 0, errors = 0;
  const errorList = [];

  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    const destPath = path.join(IMAGES_DIR, `${p.id}.jpg`);
    const localUrl  = `/images/${p.id}.jpg`;

    // Si el archivo ya existe en disco, solo actualizar el JSON
    if (fs.existsSync(destPath)) {
      p.img = localUrl;
      skipped++;
      process.stdout.write(`  [${i + 1}/${targets.length}] ⏭  ${p.id} (ya existe)\n`);
      continue;
    }

    process.stdout.write(`  [${i + 1}/${targets.length}] [${p.cat}] ${p.id} — ${p.nameEn.substring(0, 50)}... `);

    try {
      await downloadFile(p.img, destPath);
      p.img = localUrl;
      ok++;
      const kb = Math.round(fs.statSync(destPath).size / 1024);
      process.stdout.write(`OK (${kb} KB)\n`);
    } catch (err) {
      errors++;
      errorList.push({ id: p.id, name: p.nameEn, err: err.message });
      process.stdout.write(`ERROR: ${err.message}\n`);
    }

    await sleep(DELAY_MS);

    // Checkpoint cada 100 descargas
    if ((i + 1) % 100 === 0) {
      fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf-8');
      console.log(`  >> Checkpoint guardado (${ok} descargados, ${errors} errores)`);
    }
  }

  // Guardar products.json actualizado
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf-8');

  console.log('\n=== Descarga completada ===');
  console.log(`Descargadas:  ${ok}`);
  console.log(`Ya existían:  ${skipped}`);
  console.log(`Errores:      ${errors}`);
  if (errorList.length) {
    console.log('\nProductos con error:');
    errorList.forEach(e => console.log(`  ${e.id} — ${e.err}`));
  }
  console.log(`\nproducts.json actualizado: imágenes apuntan a /images/ID.jpg`);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
