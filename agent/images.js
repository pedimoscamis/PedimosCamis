'use strict';
/**
 * Imágenes: descarga original de Yupoo → WebP → Cloudflare R2.
 *
 * Mismo esquema de claves y calidad que el resto del catálogo:
 *   mascamis/{albumId}_photo{n}_resultado.webp  → https://img.pedimoscamis.com/…
 * Credenciales SOLO por entorno (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY).
 */
require('dotenv').config({ quiet: true });
const sharp = require('sharp');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { fetchBuffer } = require('./yupoo');

const BUCKET = process.env.R2_BUCKET || 'pedimoscamis';
const ENDPOINT = process.env.R2_ENDPOINT || 'https://6600c8fee14f863b13c7b9bba8869364.r2.cloudflarestorage.com';
const PUBLIC_BASE = process.env.R2_PUBLIC_BASE || 'https://img.pedimoscamis.com';
const PREFIX = 'mascamis';

const MAX_WIDTH = 1600;       // el original de Yupoo mide 1200 px: nunca se agranda
const WEBP_QUALITY = 92;
const MIN_SIDE = 500;         // por debajo es un placeholder/miniatura, no una foto de producto
const MIN_BYTES = 8 * 1024;

let client;
function r2() {
  if (client) return client;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Faltan R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (.env local o secretos del repositorio)');
  }
  client = new S3Client({ region: 'auto', endpoint: ENDPOINT, credentials: { accessKeyId, secretAccessKey } });
  return client;
}

async function exists(key) {
  try { await r2().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true; }
  catch (e) {
    if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound') return false;
    throw e;
  }
}

const keyFor = (albumId, n) => `${PREFIX}/${albumId}_photo${n}_resultado.webp`;
const urlFor = key => `${PUBLIC_BASE}/${key}`;

/** Descarga (original, o big.jpg si falla), convierte y sube una foto. */
async function processPhoto(albumId, n, photo) {
  const key = keyFor(albumId, n);
  if (await exists(key)) return { key, url: urlFor(key), reused: true };

  let buf, lastErr;
  for (const src of [photo.origin, photo.big].filter(Boolean)) {
    try {
      buf = await fetchBuffer(src);
      if (buf.length < MIN_BYTES) throw new Error(`demasiado pequeña (${buf.length} B)`);
      break;
    } catch (e) { lastErr = e; buf = null; }
  }
  if (!buf) throw new Error(`no se pudo descargar la foto ${n}: ${lastErr?.message}`);
  return uploadBuffer(albumId, n, buf);
}

/** Convierte una foto ya descargada (o local) a WebP y la sube como photo{n}. */
async function uploadBuffer(albumId, n, buf) {
  const key = keyFor(albumId, n);
  const img = sharp(buf, { failOn: 'none' });
  const meta = await img.metadata();
  if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < MIN_SIDE) {
    throw new Error(`foto ${n} con resolución insuficiente (${meta.width}x${meta.height})`);
  }
  const webp = await img
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  await r2().send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: webp, ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return { key, url: urlFor(key), bytes: webp.length, size: `${meta.width}x${meta.height}` };
}

/**
 * Procesa hasta 4 fotos de un álbum. La portada es obligatoria; si falla
 * cualquiera de las demás se aborta también (un producto con galería a medias
 * se reintentaría mejor en la siguiente ejecución que publicarse cojo).
 * @returns {{img: string, gallery: string[]}}
 */
async function uploadAlbum(albumId, photos) {
  const urls = [];
  for (let i = 0; i < photos.length; i++) {
    const r = await processPhoto(albumId, i + 1, photos[i]);
    urls.push(r.url);
  }
  return { img: urls[0], gallery: urls.slice(1) };
}

module.exports = { uploadAlbum, uploadBuffer, exists, keyFor, urlFor };
