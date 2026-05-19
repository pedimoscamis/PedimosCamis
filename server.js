/**
 * KitZone — Servidor local de desarrollo
 * Sirve index.html y el directorio data/ en http://localhost:3000
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

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

// ─── Proxy de imágenes ────────────────────────────────────────────────────
// GET /proxy?url=photo.yupoo.com/ggjersey/ID/small.jpg
// Descarga la imagen de Yupoo en el servidor y la reenvía al cliente.
// El navegador cachea 24 h gracias al header Cache-Control.
app.get('/proxy', (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).send('Falta parámetro url');

  // ── Reconstruir URL completa ─────────────────────────────────────────────
  const imageUrl = raw.startsWith('http') ? raw : `https://${raw}`;

  let parsedUrl;
  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    return res.status(400).send('URL inválida');
  }

  // Permitir solo dominios de Yupoo
  const allowed = ['photo.yupoo.com', 'img.yupoo.com', 'yupoo.com'];
  const isAllowed = allowed.some(d => parsedUrl.hostname === d || parsedUrl.hostname.endsWith('.' + d));
  if (!isAllowed) return res.status(403).send('Dominio no permitido');

  const transport = parsedUrl.protocol === 'https:' ? https : http;
  const options = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/webp,image/avif,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Referer': 'https://www.yupoo.com/',
    },
  };

  const upstream = transport.request(options, (upstreamRes) => {
    // Seguir redirecciones (máx. 3)
    if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode)) {
      const location = upstreamRes.headers['location'];
      if (location) {
        upstreamRes.resume();
        return res.redirect(`/proxy?url=${encodeURIComponent(location.replace(/^https?:\/\//, ''))}`);
      }
    }

    if (upstreamRes.statusCode !== 200) {
      upstreamRes.resume();
      return res.status(upstreamRes.statusCode).send('Error upstream');
    }

    const contentType = upstreamRes.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    upstreamRes.pipe(res);
  });

  upstream.on('error', (err) => {
    console.error('[proxy] Error:', err.message);
    if (!res.headersSent) res.status(502).send('Error al obtener imagen');
  });

  upstream.setTimeout(10000, () => {
    upstream.destroy();
    if (!res.headersSent) res.status(504).send('Timeout');
  });

  upstream.end();
});

// ─── Verificar que existen los archivos de datos
const productsFile = path.join(__dirname, 'data', 'products.json');
if (!fs.existsSync(productsFile)) {
  console.warn('⚠️  data/products.json no encontrado.');
  console.warn('   Ejecuta: node scraper.js && node categorize.js');
}

app.listen(PORT, () => {
  console.log(`\n  KitZone corriendo en http://localhost:${PORT}`);
  console.log(`  Pulsa Ctrl+C para detener\n`);
});
