'use strict';
/**
 * Migra a R2 las portadas de products.json que aún apuntan a photo.yupoo.com
 * (hotlink protegido: sin Referer devuelve 567 y el navegador no las carga).
 * Descarga con Referer, convierte a webp y sube a mascamis/{id}_cover.webp.
 */
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const FILE = path.join(__dirname, 'data', 'products.json');
const WORKER = 'https://kitzone-images.alfonsohgolderos.workers.dev';
const client = new S3Client({ region: 'auto', endpoint: 'https://6600c8fee14f863b13c7b9bba8869364.r2.cloudflarestorage.com',
  credentials: { accessKeyId: '566df4f751d6f3d8ac1d94839f034bcd', secretAccessKey: '26e30e0384e4fff6678c8b32c1f266ac8868c89c231aa2d3165335156a4794da' } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { Referer: 'https://www.yupoo.com/', 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 });
      if (r.status === 200) return await r.buffer();
    } catch (e) {}
    await sleep(1500 * (i + 1));
  }
  return null;
}
(async () => {
  const products = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  const todo = products.filter(p => p.img && /yupoo\.com/.test(p.img));
  console.log('a migrar:', todo.length);
  let ok = 0, fail = 0, idx = 0;
  async function worker() {
    while (idx < todo.length) {
      const p = todo[idx++];
      const large = p.img.replace(/\/(small|medium|square|thumb)\.(jpg|jpeg|png)$/i, '/large.jpg');
      let buf = await get(large); if (!buf && large !== p.img) buf = await get(p.img);
      if (!buf) { fail++; console.log('✗', p.id); continue; }
      try {
        const webp = await sharp(buf).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
        const key = `mascamis/${p.id}_cover.webp`;
        await client.send(new PutObjectCommand({ Bucket: 'pedimoscamis', Key: key, Body: webp, ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable' }));
        p.img = `${WORKER}/${key}`; ok++;
      } catch (e) { fail++; console.log('✗', p.id, e.message); }
      if ((ok + fail) % 50 === 0) { fs.writeFileSync(FILE, JSON.stringify(products, null, 2)); console.log('checkpoint', ok, fail); }
      await sleep(250);
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker));
  fs.writeFileSync(FILE, JSON.stringify(products, null, 2));
  console.log('RESUMEN ok', ok, 'fail', fail);
})();
