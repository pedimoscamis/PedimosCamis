'use strict';
/**
 * r2-upload-mascamis.js — Sube las fotos de galería de productos a R2
 *
 * Lee los archivos .jpg de H:\mascamis y los sube al bucket R2 bajo
 * la carpeta "mascamis/", de forma que queden accesibles en:
 *   https://pub-30dab6e51e0742a4bf695b05b150982a.r2.dev/mascamis/{filename}
 *
 * Características:
 *  - Reanudable: omite archivos que ya existen en R2
 *  - 10 subidas concurrentes
 *  - ContentType: image/jpeg
 *  - Cache-Control: 1 año (inmutable)
 *
 * Uso: node r2-upload-mascamis.js
 */

const { S3Client, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs   = require('fs');
const path = require('path');

// ─── Configuración ────────────────────────────────────────────────────────────

const IMAGES_DIR  = 'H:\\mascamis';
const R2_PREFIX   = 'mascamis';          // subcarpeta en el bucket
const BUCKET      = 'pedimoscamis';
const ENDPOINT    = 'https://6600c8fee14f863b13c7b9bba8869364.r2.cloudflarestorage.com';
const ACCESS_KEY  = '566df4f751d6f3d8ac1d94839f034bcd';
const SECRET_KEY  = '26e30e0384e4fff6678c8b32c1f266ac8868c89c231aa2d3165335156a4794da';
const REGION      = 'auto';
const CONCURRENCY = 10;

// ─── Cliente R2 ───────────────────────────────────────────────────────────────

const client = new S3Client({
  region:      REGION,
  endpoint:    ENDPOINT,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  forcePathStyle: false,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function objectExists(key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (e) {
    if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound') return false;
    throw e;
  }
}

async function uploadFile(filePath, key, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const body = fs.readFileSync(filePath);
      const ext  = path.extname(filePath).toLowerCase();
      const contentType = ext === '.png' ? 'image/png'
                        : ext === '.webp' ? 'image/webp'
                        : 'image/jpeg';
      await client.send(new PutObjectCommand({
        Bucket:       BUCKET,
        Key:          key,
        Body:         body,
        ContentType:  contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error(`❌ Directorio no encontrado: ${IMAGES_DIR}`);
    console.error('   Ejecuta primero: node download_gallery.js');
    process.exit(1);
  }

  const allFiles = fs.readdirSync(IMAGES_DIR)
    .filter(f => /\.webp$/i.test(f));
  const total = allFiles.length;

  if (total === 0) {
    console.log(`⚠️  No hay imágenes en ${IMAGES_DIR}`);
    console.log('   Ejecuta primero: node download_gallery.js');
    return;
  }

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   PedimosCamis? — R2 Upload galería (mascamis/)      ║');
  console.log(`║   Origen:   ${IMAGES_DIR.padEnd(41)}║`);
  console.log(`║   Destino:  r2.dev/${R2_PREFIX}/{''.padEnd(33)}║`);
  console.log(`║   Archivos: ${String(total).padEnd(41)}║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const start = Date.now();
  let uploaded = 0, skipped = 0, errors = 0;
  const errorList = [];
  let idx = 0;

  async function worker() {
    while (true) {
      const myIdx = idx++;
      if (myIdx >= allFiles.length) break;

      const filename = allFiles[myIdx];
      const filePath = path.join(IMAGES_DIR, filename);
      const key      = `${R2_PREFIX}/${filename}`;

      try {
        const exists = await objectExists(key);
        if (exists) {
          skipped++;
          process.stdout.write(`  ✓ ${filename} (ya existe)\n`);
        } else {
          await uploadFile(filePath, key);
          uploaded++;
          const size = fs.statSync(filePath).size;
          process.stdout.write(`  ↑ ${filename} (${(size / 1024).toFixed(0)} KB)\n`);
        }
      } catch (err) {
        errors++;
        errorList.push({ file: filename, err: err.message });
        console.warn(`  ✗ ERROR [${filename}]: ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   RESUMEN                                            ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Tiempo:      ${elapsed}s`);
  console.log(`  Subidas OK:  ${uploaded}`);
  console.log(`  Ya existían: ${skipped}`);
  console.log(`  Errores:     ${errors}`);
  console.log(`\n  URL base: https://pub-30dab6e51e0742a4bf695b05b150982a.r2.dev/${R2_PREFIX}/`);

  if (errorList.length > 0) {
    fs.writeFileSync('r2-upload-mascamis-errors.json', JSON.stringify(errorList, null, 2));
    console.log('\n  ⚠️  Errores guardados en r2-upload-mascamis-errors.json');
    console.log('     Vuelve a ejecutar el script para reintentar (omite las ya subidas).');
  } else {
    console.log('\n  ✅ Subida completa sin errores.');
    console.log('\n  Siguiente paso:');
    console.log('    git add data/products.json');
    console.log('    git commit -m "Añadir gallery[] con fotos extra de productos"');
    console.log('    git push');
  }
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err.message);
  process.exit(1);
});
