/**
 * PedimosCamis? — Aplicar URLs de Cloudinary a products.json
 *
 * Lee data/cloudinary-progress.json (mapa id → URL de Cloudinary generado
 * por upload-cloudinary.js) y actualiza data/products.json reemplazando
 * las URLs de Yupoo por las URLs de Cloudinary para todos los productos
 * que ya fueron subidos.
 *
 * Es idempotente: ejecutarlo varias veces no duplica ni rompe nada.
 *
 * Uso:
 *   node apply-cloudinary.js
 */

const fs   = require('fs');
const path = require('path');

const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const PROGRESS_FILE = path.join(__dirname, 'data', 'cloudinary-progress.json');

// ─── Validaciones ─────────────────────────────────────────────────────────────

if (!fs.existsSync(PRODUCTS_FILE)) {
  console.error('Error: data/products.json no encontrado.');
  process.exit(1);
}
if (!fs.existsSync(PROGRESS_FILE)) {
  console.error('Error: data/cloudinary-progress.json no encontrado.');
  console.error('Ejecuta primero: node upload-cloudinary.js');
  process.exit(1);
}

// ─── Carga ────────────────────────────────────────────────────────────────────

const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));

const progressIds = new Set(Object.keys(progress));

// ─── Aplicar ──────────────────────────────────────────────────────────────────

let updated      = 0;
let alreadyDone  = 0;
let notInProgress = 0;

for (const p of products) {
  const cloudUrl = progress[String(p.id)];

  if (!cloudUrl) {
    notInProgress++;
    continue;
  }

  if (p.img && p.img.includes('cloudinary.com')) {
    alreadyDone++;
    continue;
  }

  p.img = cloudUrl;
  updated++;
}

// ─── Guardar ──────────────────────────────────────────────────────────────────

if (updated > 0) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf-8');
}

// ─── Resumen ──────────────────────────────────────────────────────────────────

console.log('=== PedimosCamis? — Apply Cloudinary ===\n');
console.log(`Entradas en cloudinary-progress.json : ${progressIds.size}`);
console.log(`Productos en products.json            : ${products.length}`);
console.log(`─────────────────────────────────────`);
console.log(`Actualizados ahora                    : ${updated}`);
console.log(`Ya tenían URL de Cloudinary           : ${alreadyDone}`);
console.log(`Sin subida en progress                : ${notInProgress}`);

if (updated > 0) {
  console.log('\nproducts.json actualizado correctamente.');
} else if (alreadyDone === progressIds.size) {
  console.log('\nTodos los productos subidos ya tenían URL de Cloudinary. Nada que hacer.');
} else {
  console.log('\nNada que actualizar.');
}
