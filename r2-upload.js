'use strict';
/**
 * r2-upload.js — Subida masiva de imágenes .webp a Cloudflare R2
 *
 * Uso: node r2-upload.js
 *
 * Características:
 *  - 20 subidas concurrentes para maximizar el ancho de banda
 *  - Reanudable: comprueba si el objeto ya existe en R2 y lo omite
 *  - ContentType: image/webp en cada objeto → los navegadores renderizan
 *  - Cache-Control: 1 año (imágenes de catálogo, no cambian)
 *  - Log cada 100 subidas + resumen final con errores
 */

const { S3Client, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs   = require('fs');
const path = require('path');

// ─── Configuración ────────────────────────────────────────────────────────────

const IMAGES_DIR   = 'C:/Users/Alfonso/Downloads/Camis_Optimizadas';
const BUCKET       = 'pedimoscamis';
const ENDPOINT     = 'https://6600c8fee14f863b13c7b9bba8869364.r2.cloudflarestorage.com';
const ACCESS_KEY   = '566df4f751d6f3d8ac1d94839f034bcd';
const SECRET_KEY   = '26e30e0384e4fff6678c8b32c1f266ac8868c89c231aa2d3165335156a4794da';
const REGION       = 'auto';
const CONCURRENCY  = 20;
const LOG_EVERY    = 100;

// ─── Cliente R2 ───────────────────────────────────────────────────────────────

const client = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
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
      await client.send(new PutObjectCommand({
        Bucket:       BUCKET,
        Key:          key,
        Body:         body,
        ContentType:  'image/webp',
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
  const allFiles = fs.readdirSync(IMAGES_DIR).filter(f => f.endsWith('.webp'));
  const total    = allFiles.length;

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   PedimosCamis? — Cloudflare R2 Upload               ║');
  console.log(`║   Bucket:  ${BUCKET.padEnd(42)}║`);
  console.log(`║   Archivos: ${String(total).padEnd(41)}║`);
  console.log(`║   Workers:  ${String(CONCURRENCY).padEnd(41)}║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const start = Date.now();
  let uploaded = 0, skipped = 0, errors = 0;
  const errorList = [];
  let idx = 0;

  async function worker(id) {
    while (true) {
      const myIdx = idx++;
      if (myIdx >= allFiles.length) break;

      const filename = allFiles[myIdx];
      const filePath = path.join(IMAGES_DIR, filename);
      const key      = filename; // sube directo a la raíz del bucket

      try {
        // Comprobar si ya existe (reanudable)
        const exists = await objectExists(key);
        if (exists) {
          skipped++;
        } else {
          await uploadFile(filePath, key);
          uploaded++;
        }

        const done = uploaded + skipped + errors;
        if (done % LOG_EVERY === 0) {
          const pct     = (done / total * 100).toFixed(1);
          const elapsed = ((Date.now() - start) / 1000).toFixed(0);
          const rate    = (uploaded / (elapsed || 1)).toFixed(1);
          console.log(
            `  [${done}/${total}] ${pct}% — ` +
            `subidas: ${uploaded}  omitidas: ${skipped}  errores: ${errors}  ` +
            `(${rate} img/s, ${elapsed}s)`
          );
        }
      } catch (err) {
        errors++;
        errorList.push({ file: filename, err: err.message });
        if (errors <= 10 || errors % 50 === 0) {
          console.warn(`  ⚠ ERROR [${filename}]: ${err.message}`);
        }
      }
    }
  }

  // Lanzar CONCURRENCY workers en paralelo
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   RESUMEN FINAL                                      ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Tiempo total:   ${elapsed}s (~${(elapsed/60).toFixed(1)} min)`);
  console.log(`  Subidas OK:     ${uploaded}`);
  console.log(`  Ya existían:    ${skipped}`);
  console.log(`  Errores:        ${errors}`);
  console.log(`\n  URL pública base: https://pub-XXXX.r2.dev/`);
  console.log(`  Ejemplo:          https://pub-XXXX.r2.dev/${allFiles[0]}`);

  if (errorList.length > 0) {
    const errFile = path.join(__dirname, 'r2-upload-errors.json');
    fs.writeFileSync(errFile, JSON.stringify(errorList, null, 2), 'utf-8');
    console.log(`\n  ⚠ Errores guardados en: r2-upload-errors.json`);
    console.log('    Vuelve a ejecutar el script para reintentar (omite las ya subidas).');
  } else {
    console.log('\n  ✅ Sin errores. Subida completa.');
  }
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err.message);
  process.exit(1);
});
