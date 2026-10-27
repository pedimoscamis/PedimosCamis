'use strict';
/**
 * Lectura de Yupoo (listado de colección y álbum). Solo HTTP + cheerio.
 */
const cheerio = require('cheerio');

const SHOP = 'https://ggjersey.x.yupoo.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer': `${SHOP}/`,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, label, retries = 4) {
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i < retries) await sleep(1500 * i * i);
    }
  }
  throw new Error(`${label}: ${lastErr.message}`);
}

async function fetchHtml(url) {
  return withRetry(async () => {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }, url);
}

async function fetchBuffer(url) {
  return withRetry(async () => {
    const res = await fetch(url, {
      headers: { ...HEADERS, Accept: 'image/webp,image/avif,image/*,*/*;q=0.8' },
      signal: AbortSignal.timeout(40000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }, url);
}

const photoId = u => (String(u).match(/\/ggjersey\/([A-Za-z0-9]+)\//) || [])[1] || null;
const https = u => (u.startsWith('//') ? `https:${u}` : u);

/** Una página de la colección. → { albums: [{id, title, coverId}], totalPages } */
async function listPage(collectionUrl, page) {
  const sep = collectionUrl.includes('?') ? '&' : '?';
  const html = await fetchHtml(`${collectionUrl}${sep}page=${page}`);
  const $ = cheerio.load(html);
  const albums = [];
  $('a.album__main').each((_, a) => {
    const href = $(a).attr('href') || '';
    const id = (href.match(/\/albums\/(\d+)/) || [])[1];
    const title = ($(a).attr('title') || '').trim();
    if (!id || !title) return;
    const img = $(a).find('img').first();
    albums.push({ id, title, coverId: photoId(img.attr('data-src') || img.attr('src') || '') });
  });
  const span = $('.categories__box-right-pagination-span').first().text();
  const m = span.match(/(\d+)\s*\/\s*(\d+)/);
  return { albums, totalPages: m ? parseInt(m[2], 10) : null };
}

/**
 * Fotos de un álbum, en el orden pedido: portada primero y después las
 * siguientes del álbum. La portada de Yupoo (og:image) no tiene por qué ser
 * la primera foto del álbum, así que se coloca explícitamente la primera.
 * Devuelve URLs de ORIGINAL (1200 px, mejor que big.jpg de 1080).
 *   → { urls: [..max n], total, coverId }
 */
async function albumPhotos(albumId, n = 4, hintCoverId = null) {
  const html = await fetchHtml(`${SHOP}/albums/${albumId}?uid=1`);
  const $ = cheerio.load(html);

  const photos = [];   // { id, origin, big }
  const seen = new Set();
  $('img.image__img, img[data-origin-src]').each((_, el) => {
    const origin = $(el).attr('data-origin-src') || '';
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    const id = photoId(origin) || photoId(src);
    if (!id || seen.has(id)) return;
    seen.add(id);
    photos.push({
      id,
      origin: origin ? https(origin) : null,
      big: `https://photo.yupoo.com/ggjersey/${id}/big.jpg`,
    });
  });

  const og = $('meta[property="og:image"]').attr('content') || '';
  const coverId = photoId(og) || hintCoverId;

  const ordered = [];
  const cover = photos.find(p => p.id === coverId);
  if (cover) ordered.push(cover);
  else if (coverId) ordered.push({ id: coverId, origin: null, big: `https://photo.yupoo.com/ggjersey/${coverId}/big.jpg` });
  for (const p of photos) if (p.id !== coverId) ordered.push(p);

  return {
    urls: ordered.slice(0, n).map(p => ({ id: p.id, origin: p.origin, big: p.big })),
    total: Math.max(photos.length, ordered.length),
    coverId,
  };
}

module.exports = { SHOP, sleep, fetchHtml, fetchBuffer, listPage, albumPhotos };
