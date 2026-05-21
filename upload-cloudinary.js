require('dotenv').config();

/**
 * PedimosCamis? — Subida de imágenes a Cloudinary
 *
 * Lee products.json, descarga cada imagen de Yupoo y la sube a Cloudinary.
 * Actualiza el campo img con la URL de Cloudinary entregada por el CDN.
 * Guarda progreso en data/cloudinary-progress.json para poder reanudar
 * en cualquier momento sin repetir subidas ya completadas.
 *
 * Uso:
 *   CLOUDINARY_CLOUD_NAME=xxx CLOUDINARY_API_KEY=yyy CLOUDINARY_API_SECRET=zzz \
 *   node upload-cloudinary.js
 *
 * O crea un archivo .env con esas variables y usa:
 *   node -r dotenv/config upload-cloudinary.js
 */

const { v2: cloudinary } = require('cloudinary');
const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const stream = require('stream');

// ─── Configuración ────────────────────────────────────────────────────────────

const PRODUCTS_FILE  = path.join(__dirname, 'data', 'products.json');
const PROGRESS_FILE  = path.join(__dirname, 'data', 'cloudinary-progress.json');
const DELAY_MS       = 300;
const CLOUDINARY_FOLDER = 'kitzone';

// ─── Validar credenciales ─────────────────────────────────────────────────────

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.error('Error: faltan variables de entorno de Cloudinary.');
  console.error('  CLOUDINARY_CLOUD_NAME');
  console.error('  CLOUDINARY_API_KEY');
  console.error('  CLOUDINARY_API_SECRET');
  process.exit(1);
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key:    CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
  secure:     true,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8')); }
  catch { return {}; }
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
}

/**
 * Descarga una URL de Yupoo y devuelve un Buffer.
 * Sigue redirecciones hasta 5 saltos.
 */
function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Demasiadas redirecciones'));

    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    let parsed;
    try { parsed = new URL(fullUrl); }
    catch { return reject(new Error(`URL inválida: ${url}`)); }

    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        hostname: parsed.hostname,
        path:     parsed.pathname + parsed.search,
        method:   'GET',
        headers:  {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept':     'image/webp,image/avif,image/*,*/*;q=0.8',
          'Referer':    'https://www.yupoo.com/',
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const loc = res.headers['location'];
          res.resume();
          if (loc) return resolve(fetchBuffer(loc, redirects + 1));
          return reject(new Error('Redirección sin Location'));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

/**
 * Sube un Buffer a Cloudinary y devuelve la URL segura resultante.
 * Usa el id del producto como public_id para que sea idempotente:
 * subir el mismo id dos veces sobreescribe la misma imagen.
 */
function uploadBuffer(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder:    CLOUDINARY_FOLDER,
        public_id: publicId,
        overwrite: true,
        resource_type: 'image',
        // Transformación en subida: normalizar a JPEG 800px de ancho máximo
        transformation: [{ width: 800, crop: 'limit', fetch_format: 'jpg', quality: 'auto' }],
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result.secure_url);
      }
    );
    const readable = new stream.PassThrough();
    readable.end(buffer);
    readable.pipe(uploadStream);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== PedimosCamis? Upload Cloudinary ===');
  console.log(`Cloud: ${CLOUDINARY_CLOUD_NAME}  Carpeta: ${CLOUDINARY_FOLDER}\n`);

  if (!fs.existsSync(PRODUCTS_FILE)) {
    console.error('Error: data/products.json no encontrado.');
    process.exit(1);
  }

  const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));

  // Progreso previo: { [productId]: cloudinaryUrl }
  const progress = loadProgress();
  const doneIds  = new Set(Object.keys(progress));

  // Aplicar URLs ya subidas a productos que aún no las tengan en el JSON
  let alreadyApplied = 0;
  for (const p of products) {
    if (doneIds.has(p.id) && !p.img?.includes('cloudinary.com')) {
      p.img = progress[p.id];
      alreadyApplied++;
    }
  }

  // Productos pendientes: tienen img de Yupoo y no están en el progreso
  const pending = products.filter(p =>
    p.img &&
    !p.img.includes('cloudinary.com') &&
    !p.img.startsWith('/images/') &&
    !doneIds.has(p.id)
  );

  const cloudinaryCount = products.filter(p => p.img?.includes('cloudinary.com')).length;

  console.log(`Total productos:            ${products.length}`);
  console.log(`Ya en Cloudinary (JSON):    ${cloudinaryCount}`);
  console.log(`Ya en progreso (aplicados): ${alreadyApplied}`);
  console.log(`Pendientes de subir:        ${pending.length}\n`);

  if (pending.length === 0) {
    console.log('Nada que subir.');
    if (alreadyApplied > 0) {
      fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf-8');
      console.log('products.json actualizado con URLs ya guardadas en el progreso.');
    }
    return;
  }

  let ok = 0, errors = 0;
  const errorList = [];

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    const label = `[${i + 1}/${pending.length}] [${p.cat}] ${p.id}`;

    process.stdout.write(`  ${label} — ${p.nameEn.substring(0, 45)}... `);

    try {
      // 1. Descargar de Yupoo
      const buffer = await fetchBuffer(p.img);

      // 2. Subir a Cloudinary
      const cloudUrl = await uploadBuffer(buffer, p.id);

      // 3. Actualizar producto y guardar progreso
      p.img = cloudUrl;
      progress[p.id] = cloudUrl;
      ok++;

      process.stdout.write(`OK → ${cloudUrl.split('/').pop()}\n`);
    } catch (err) {
      errors++;
      errorList.push({ id: p.id, name: p.nameEn, err: err.message });
      process.stdout.write(`ERROR: ${err.message}\n`);
    }

    // Guardar progreso y checkpoint de products.json cada 50 subidas
    if ((i + 1) % 50 === 0) {
      saveProgress(progress);
      fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf-8');
      console.log(`  >> Checkpoint: ${ok} subidas, ${errors} errores`);
    }

    await sleep(DELAY_MS);
  }

  // Guardado final
  saveProgress(progress);
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf-8');

  console.log('\n=== Subida completada ===');
  console.log(`Subidas OK:  ${ok}`);
  console.log(`Errores:     ${errors}`);
  if (errorList.length) {
    console.log('\nProductos con error:');
    errorList.slice(0, 20).forEach(e => console.log(`  ${e.id} — ${e.err}`));
    if (errorList.length > 20) console.log(`  ... y ${errorList.length - 20} más`);
  }
  console.log('\nproducts.json actualizado con URLs de Cloudinary.');
  console.log('Ejecuta de nuevo el script para reintentar los errores.');
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
