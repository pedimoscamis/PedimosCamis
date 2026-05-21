/**
 * PedimosCamis? — fix-cloudinary.js
 *
 * Lee data/cloudinary-progress.json y data/products.json.
 * Para cada producto cuyo id esté en el progreso, reemplaza
 * su campo img con la URL de Cloudinary del progreso.
 * Guarda el products.json actualizado y muestra cuántos se actualizaron.
 *
 * Uso: node fix-cloudinary.js
 */

const fs   = require('fs');
const path = require('path');

const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const PROGRESS_FILE = path.join(__dirname, 'data', 'cloudinary-progress.json');

// ── Leer archivos ─────────────────────────────────────────────────────────────

const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));

// ── Aplicar ───────────────────────────────────────────────────────────────────

let updated = 0;

for (const product of products) {
  const cloudUrl = progress[String(product.id)];
  if (cloudUrl) {
    product.img = cloudUrl;
    updated++;
  }
}

// ── Guardar ───────────────────────────────────────────────────────────────────

fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf-8');

// ── Resultado ─────────────────────────────────────────────────────────────────

console.log(`Productos actualizados: ${updated} / ${products.length}`);
