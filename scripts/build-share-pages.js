/**
 * Genera una página estática por producto en <outDir>/p/<id>.html con las
 * etiquetas Open Graph (nombre + foto) para que los enlaces compartidos
 * muestren vista previa en WhatsApp, Instagram, Telegram, etc. Cada página
 * redirige al instante a la tienda con el producto abierto (../?p=<id>).
 *
 * Uso: node scripts/build-share-pages.js [outDir]   (por defecto: raíz del repo)
 * Se ejecuta en el deploy (.github/workflows/deploy.yml); no se versiona p/.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.resolve(process.argv[2] || root, 'p');
const products = require(path.join(root, 'data/products.json'));

// Reutilizar las mismas traducciones de nombre que usa la web (index.html).
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const m = html.match(/const NOMBRE_TRANSLATIONS = (\[[\s\S]*?\n\]);/);
const NOMBRE_TRANSLATIONS = m ? new Function(`return ${m[1]}`)() : [];
const traducirNombre = name => NOMBRE_TRANSLATIONS.reduce((r, [re, rep]) => r.replace(re, rep), name || '');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

let n = 0;
for (const p of products) {
  if (p.id == null) continue;
  const id = String(p.id);
  const title = esc(`${traducirNombre(p.nameEn || p.nameEs)} — PedimosCamis?`);
  const desc = esc('Camisetas de fútbol y NBA. Calidad premium, precios imbatibles. Personalízala con nombre y dorsal.');
  const target = `../?p=${encodeURIComponent(id)}`;
  const img = p.img ? `<meta property="og:image" content="${esc(p.img)}">\n<meta name="twitter:image" content="${esc(p.img)}">\n` : '';
  fs.writeFileSync(path.join(outDir, `${id}.html`), `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="PedimosCamis?">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
${img}<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${target}">
<script>location.replace(${JSON.stringify(target)});</script>
</head><body><a href="${target}">Ver camiseta</a></body></html>
`);
  n++;
}
console.log(`✓ ${n} páginas de producto en ${path.relative(process.cwd(), outDir) || outDir}`);
