'use strict';
/**
 * r2-upload-new-catalog.js — Sube las 1.078 imágenes nuevas (26/27) a R2
 *
 * Variante de r2-upload.js apuntando a la carpeta generada por
 * download-new-images.js (./images-nuevas-webp), subiendo a la raíz
 * del bucket con el mismo convenio que el resto del catálogo:
 *   https://pub-30dab6e51e0742a4bf695b05b150982a.r2.dev/{id}.webp
 *
 * Uso: node r2-upload-new-catalog.js
 */

const { S3Client, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs   = require('fs');
const path = require('path');

// ─── Configuración ────────────────────────────────────────────────────────────

const IMAGES_DIR   = path.join(__dirname, 'images-nuevas-webp');
const BUCKET       = 'pedimoscamis';
const ENDPOINT     = 'https://6600c8fee14f863b13c7b9bba8869364.r2.cloudflarestorage.com';
const ACCESS_KEY   = '566df4f751d6f3d8ac1d94839f034bcd';
const SECRET_KEY   = '26e30e0384e4fff6678c8b32c1f266ac8868c89c231aa2d3165335156a4794da';
const REGION       = 'auto';
const CONCURRENCY  = 8;
const LOG_EVERY    = 100;
const PUBLIC_BASE  = 'https://pub-30dab6e51e0742a4bf695b05b150982a.r2.dev';

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
  console.log('║   PedimosCamis? — R2 Upload (catálogo nuevo 26/27)   ║');
  console.log(`║   Bucket:  ${BUCKET.padEnd(42)}║`);
  console.log(`║   Archivos: ${String(total).padEnd(41)}║`);
  console.log(`║   Workers:  ${String(CONCURRENCY).padEnd(41)}║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const start = Date.now();
  let uploaded = 0, skipped = 0, errors = 0;
  const errorList = [];
  const uploadedKeys = [];
  let idx = 0;

  async function worker() {
    while (true) {
      const myIdx = idx++;
      if (myIdx >= allFiles.length) break;

      const filename = allFiles[myIdx];
      const filePath = path.join(IMAGES_DIR, filename);
      const key      = filename; // sube directo a la raíz del bucket

      try {
        const exists = await objectExists(key);
        if (exists) {
          skipped++;
        } else {
          await uploadFile(filePath, key);
          uploaded++;
        }
        uploadedKeys.push(key);

        const done = uploaded + skipped + errors;
        if (done % LOG_EVERY === 0 || done === total) {
          const pct     = (done / total * 100).toFixed(1);
          const elapsed = ((Date.now() - start) / 1000).toFixed(0);
          console.log(`  [${done}/${total}] ${pct}% — subidas: ${uploaded}  omitidas: ${skipped}  errores: ${errors}  (${elapsed}s)`);
        }
      } catch (err) {
        errors++;
        errorList.push({ file: filename, err: err.message });
        console.warn(`  ⚠ ERROR [${filename}]: ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log('\n=== RESUMEN FINAL ===');
  console.log(`Tiempo total: ${elapsed}s`);
  console.log(`Subidas OK:   ${uploaded}`);
  console.log(`Ya existían:  ${skipped}`);
  console.log(`Errores:      ${errors}`);
  console.log(`\nURL pública ejemplo: ${PUBLIC_BASE}/${allFiles[0]}`);

  fs.writeFileSync(
    path.join(__dirname, 'data', 'r2-uploaded-keys.json'),
    JSON.stringify(uploadedKeys, null, 2),
    'utf-8'
  );

  if (errorList.length > 0) {
    fs.writeFileSync(path.join(__dirname, 'r2-upload-errors.json'), JSON.stringify(errorList, null, 2), 'utf-8');
    console.log('\n⚠ Errores guardados en r2-upload-errors.json. Vuelve a ejecutar para reintentar.');
  } else {
    console.log('\n✅ Sin errores. Subida completa.');
  }
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
