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

// ─── Caché en memoria para el proxy ──────────────────────────────────────
// Clave: URL normalizada sin protocolo. Valor: { contentType, buffer }.
// Las imágenes se retienen mientras el proceso esté vivo (sin límite de tamaño
// intencionado: en Railway el contenedor se reinicia periódicamente).
const imageCache = new Map();

// ─── Proxy de imágenes ────────────────────────────────────────────────────
// GET /proxy?url=photo.yupoo.com/ggjersey/ID/small.jpg
// 1ª petición → descarga de Yupoo, guarda en imageCache y responde.
// Siguientes peticiones → sirve desde imageCache sin tocar Yupoo.
// El navegador también cachea 24 h gracias al header Cache-Control.
app.get('/proxy', (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).send('Falta parámetro url');

  // Normalizar clave: siempre sin protocolo
  const cacheKey = raw.replace(/^https?:\/\//, '');

  // ── Servir desde caché si existe ────────────────────────────────────────
  if (imageCache.has(cacheKey)) {
    const { contentType, buffer } = imageCache.get(cacheKey);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Cache', 'HIT');
    return res.end(buffer);
  }

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

    // Acumular chunks para guardar en caché
    const chunks = [];
    upstreamRes.on('data', chunk => chunks.push(chunk));
    upstreamRes.on('end', () => {
      const buffer = Buffer.concat(chunks);
      imageCache.set(cacheKey, { contentType, buffer });

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Cache', 'MISS');
      res.end(buffer);
    });
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
