/**
 * KitZone — Servidor local de desarrollo
 * Sirve index.html y el directorio data/ en http://localhost:3000
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Servir archivos estáticos desde la raíz del proyecto
app.use(express.static(path.join(__dirname), {
  index: 'index.html',
  setHeaders(res, filePath) {
    // CORS abierto para desarrollo local
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Cache corto para JSON en desarrollo
    if (filePath.endsWith('.json')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// Verificar que existen los archivos de datos
const productsFile = path.join(__dirname, 'data', 'products.json');
if (!fs.existsSync(productsFile)) {
  console.warn('⚠️  data/products.json no encontrado.');
  console.warn('   Ejecuta: node scraper.js && node categorize.js');
}

app.listen(PORT, () => {
  console.log(`\n  KitZone corriendo en http://localhost:${PORT}`);
  console.log(`  Pulsa Ctrl+C para detener\n`);
});
