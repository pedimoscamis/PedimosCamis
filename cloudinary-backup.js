/**
 * cloudinary-backup.js — Backup masivo de imágenes desde Cloudinary
 *
 * Usa la Admin API para listar TODOS los recursos (paginación automática
 * con next_cursor) y los descarga a la carpeta "Camis_Originales_Backup/".
 *
 * Características:
 *  - Reanudable: omite archivos que ya existen en disco.
 *  - Descarga concurrente (CONCURRENCY workers simultáneos).
 *  - Log de progreso cada 100 imágenes descargadas.
 *  - Checkpoint JSON con la lista completa antes de descargar.
 *  - Respeta la estructura de carpetas de Cloudinary.
 *
 * Uso:
 *   node cloudinary-backup.js
 *
 * Variables de entorno necesarias (cargadas desde .env):
 *   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 */

'use strict';
require('dotenv').config();

const { v2: cloudinary } = require('cloudinary');
const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');

// ─── Configuración ────────────────────────────────────────────────────────────

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

const BACKUP_DIR       = path.join(__dirname, 'Camis_Originales_Backup');
const CHECKPOINT_FILE  = path.join(__dirname, 'cloudinary-backup-list.json');
const MAX_RESULTS      = 500;   // Máximo permitido por la API
const CONCURRENCY      = 8;     // Descargas simultáneas
const LOG_EVERY        = 100;   // Log de progreso cada N imágenes
const RETRY_ATTEMPTS   = 3;
const RETRY_DELAY_MS   = 2000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Descarga una URL a destPath, siguiendo redirecciones y reintentando
 * hasta RETRY_ATTEMPTS veces en caso de error.
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error(`URL inválida: ${url}`)); }

    const attempt = (n) => {
      const transport = parsed.protocol === 'https:' ? https : http;
      const req = transport.get(
        { hostname: parsed.hostname, path: parsed.pathname + parsed.search,
          headers: { 'User-Agent': 'cloudinary-backup/1.0' },
          timeout: 30000,
        },
        (res) => {
          // Redireccionamiento
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            try { parsed = new URL(res.headers.location); } catch { return reject(new Error('Redirección inválida')); }
            return attempt(n);
          }
          if (res.statusCode !== 200) {
            res.resume();
            if (n < RETRY_ATTEMPTS) {
              return setTimeout(() => attempt(n + 1), RETRY_DELAY_MS * n);
            }
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          // Crear directorio padre si no existe
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          const file = fs.createWriteStream(destPath + '.tmp');
          res.pipe(file);
          file.on('finish', () => {
            file.close(() => {
              fs.renameSync(destPath + '.tmp', destPath); // atómico
              resolve();
            });
          });
          file.on('error', (err) => {
            fs.unlink(destPath + '.tmp', () => {});
            if (n < RETRY_ATTEMPTS) setTimeout(() => attempt(n + 1), RETRY_DELAY_MS * n);
            else reject(err);
          });
        }
      );
      req.on('error', (err) => {
        if (n < RETRY_ATTEMPTS) setTimeout(() => attempt(n + 1), RETRY_DELAY_MS * n);
        else reject(err);
      });
      req.on('timeout', () => {
        req.destroy();
        if (n < RETRY_ATTEMPTS) setTimeout(() => attempt(n + 1), RETRY_DELAY_MS * n);
        else reject(new Error('Timeout'));
      });
    };

    attempt(1);
  });
}

/**
 * Convierte un public_id de Cloudinary ("carpeta/subcarpeta/nombre")
 * en una ruta local respetando la jerarquía de carpetas.
 */
function publicIdToPath(publicId, format) {
  // Sanear cada segmento del path
  const segments = publicId.split('/').map(s =>
    s.replace(/[<>:"|?*\x00-\x1f]/g, '_') // caracteres inválidos en Windows
  );
  const ext = format ? `.${format}` : '';
  return path.join(BACKUP_DIR, ...segments) + ext;
}

// ─── Fase 1: Listar todos los recursos ───────────────────────────────────────

async function listAllResources() {
  // Si ya existe el checkpoint, preguntar si reutilizarlo
  if (fs.existsSync(CHECKPOINT_FILE)) {
    console.log(`\n⚡ Encontrado checkpoint previo: ${CHECKPOINT_FILE}`);
    console.log('   Reutilizando lista (si quieres volver a listar, borra el archivo y reinicia).\n');
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
  }

  console.log('📋 Fase 1: Listando todos los recursos en Cloudinary...\n');

  const resources = [];
  let cursor      = null;
  let page        = 0;

  do {
    page++;
    const params = { resource_type: 'image', max_results: MAX_RESULTS };
    if (cursor) params.next_cursor = cursor;

    let result;
    try {
      result = await cloudinary.api.resources(params);
    } catch (err) {
      console.error(`  ERROR en la página ${page}:`, err.message);
      // Esperar y reintentar una vez
      await sleep(5000);
      result = await cloudinary.api.resources(params);
    }

    resources.push(...result.resources);
    cursor = result.next_cursor || null;

    process.stdout.write(
      `  Página ${page} — ${result.resources.length} recursos | Total acumulado: ${resources.length}${cursor ? '...' : ' (fin)'}\n`
    );
  } while (cursor);

  console.log(`\n✅ Listado completo: ${resources.length} imágenes encontradas.`);

  // Guardar checkpoint para poder reanudar sin volver a llamar a la API
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(resources, null, 2), 'utf-8');
  console.log(`   Lista guardada en: ${CHECKPOINT_FILE}\n`);

  return resources;
}

// ─── Fase 2: Descargar con concurrencia ──────────────────────────────────────

async function downloadAll(resources) {
  console.log('📥 Fase 2: Descargando imágenes...\n');

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // Calcular cuáles ya están en disco (reanudable)
  const pending = resources.filter(r => {
    const destPath = publicIdToPath(r.public_id, r.format);
    return !fs.existsSync(destPath);
  });

  const alreadyDone = resources.length - pending.length;
  console.log(`  Total:        ${resources.length}`);
  console.log(`  Ya en disco:  ${alreadyDone}  (se omiten)`);
  console.log(`  Pendientes:   ${pending.length}`);
  console.log(`  Workers:      ${CONCURRENCY} descargas simultáneas\n`);

  if (pending.length === 0) {
    console.log('✅ Todas las imágenes ya están en disco. Nada que descargar.');
    return { ok: 0, skipped: alreadyDone, errors: 0, errorList: [] };
  }

  let ok = 0, errors = 0;
  const errorList = [];
  let idx = 0;

  // Worker: consume la lista pending de forma compartida
  async function worker(workerId) {
    while (true) {
      const myIdx = idx++;
      if (myIdx >= pending.length) break;

      const r        = pending[myIdx];
      const destPath = publicIdToPath(r.public_id, r.format);
      // URL de descarga: secure_url es la URL de entrega original sin transformaciones
      const url      = r.secure_url;

      try {
        await downloadFile(url, destPath);
        ok++;

        // Log cada LOG_EVERY imágenes (comparamos el total descargado)
        if (ok % LOG_EVERY === 0) {
          const pct = ((ok + alreadyDone) / resources.length * 100).toFixed(1);
          console.log(
            `  [${ok + alreadyDone}/${resources.length}] ${pct}% — ` +
            `${ok} descargadas, ${errors} errores (worker ${workerId})`
          );
        }
      } catch (err) {
        errors++;
        errorList.push({ publicId: r.public_id, url, err: err.message });
        // Log de error individual sin saturar la consola
        if (errors <= 20 || errors % 50 === 0) {
          console.warn(`  ⚠ ERROR [${r.public_id}]: ${err.message}`);
        }
      }
    }
  }

  // Lanzar CONCURRENCY workers en paralelo
  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1))
  );

  return { ok, skipped: alreadyDone, errors, errorList };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   PedimosCamis? — Cloudinary Backup                 ║');
  console.log(`║   Cloud: ${process.env.CLOUDINARY_CLOUD_NAME.padEnd(44)}║`);
  console.log(`║   Destino: Camis_Originales_Backup/                  ║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // Validar credenciales
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.error('❌ Faltan variables de entorno. Verifica tu .env');
    process.exit(1);
  }

  const startTime = Date.now();

  // Fase 1: listar
  const resources = await listAllResources();

  // Fase 2: descargar
  const { ok, skipped, errors, errorList } = await downloadAll(resources);

  // Resumen final
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   RESUMEN FINAL                                      ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Tiempo total:   ${elapsed}s`);
  console.log(`  Descargadas:    ${ok}`);
  console.log(`  Ya existían:    ${skipped}`);
  console.log(`  Errores:        ${errors}`);
  console.log(`  Carpeta:        ${BACKUP_DIR}`);

  if (errorList.length > 0) {
    const errFile = path.join(__dirname, 'cloudinary-backup-errors.json');
    fs.writeFileSync(errFile, JSON.stringify(errorList, null, 2), 'utf-8');
    console.log(`\n  ⚠ Lista de errores guardada en: ${errFile}`);
    console.log('    Puedes volver a ejecutar el script para reintentar');
    console.log('    (los archivos ya descargados se omiten automáticamente).\n');
  } else {
    // Limpiar checkpoint si todo fue bien
    if (fs.existsSync(CHECKPOINT_FILE)) {
      fs.unlinkSync(CHECKPOINT_FILE);
      console.log('\n  🧹 Checkpoint eliminado (backup completo y sin errores).');
    }
  }

  console.log('\n✅ Backup finalizado.\n');
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err.message);
  process.exit(1);
});
