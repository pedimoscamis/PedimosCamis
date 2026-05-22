# PedimosCamis? 🛍️

Tienda online de camisetas de fútbol y NBA. Catálogo extraído automáticamente de Yupoo, desplegada en GitHub Pages con actualización diaria vía GitHub Actions.

---

## Requisitos previos

- [Node.js](https://nodejs.org/) v18 o superior
- Conexión a internet (el scraper accede a ggjersey.x.yupoo.com)
- Cuenta en GitHub (para el despliegue en GitHub Pages)

---

## Instalación

```bash
# Clona el repositorio
git clone https://github.com/TU_USUARIO/kitzone.git
cd kitzone

# Instala las dependencias
npm install
```

---

## Uso

### 1. Ejecutar el scraper por primera vez

```bash
node scraper.js
```

> **Aviso:** La primera ejecución recorre las 127 páginas del catálogo (con delays de 800ms entre páginas y 600ms entre álbumes). Puede tardar **entre 3 y 6 horas** dependiendo de tu conexión. Las ejecuciones posteriores son incrementales y solo procesan productos nuevos.

Al terminar, genera `data/products-raw.json` con todos los productos y sus imágenes.

### 2. Categorizar los productos

```bash
node categorize.js
```

Lee `products-raw.json` y genera `data/products.json` con categorías, tallas y precios. Tarda solo unos segundos.

### 3. Arrancar el servidor local

```bash
node server.js
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador. La tienda carga `data/products.json` vía fetch y muestra el catálogo completo.

---

## Despliegue en GitHub Pages

### Paso 1 — Crear el repositorio en GitHub

1. Ve a [github.com/new](https://github.com/new) y crea un repositorio llamado `kitzone`.
2. Sube el proyecto:

```bash
git init
git add .
git commit -m "feat: PedimosCamis? inicial"
git remote add origin https://github.com/TU_USUARIO/kitzone.git
git push -u origin main
```

### Paso 2 — Activar GitHub Pages

1. Ve a **Settings → Pages** en tu repositorio.
2. En **Source**, selecciona **GitHub Actions**.
3. El workflow `deploy.yml` se ejecutará automáticamente con cada push a `main`.

### Paso 3 — Verificar el despliegue

La web quedará disponible en:

```
https://TU_USUARIO.github.io/kitzone/
```

> Si el nombre de tu repositorio es diferente a `kitzone`, actualiza el campo `BASE_PATH` en `index.html` (línea con `'/kitzone'`).

---

## Actualización automática del catálogo

El workflow `update-catalog.yml` se ejecuta **cada día a las 4:00 AM UTC**:

1. Ejecuta `node scraper.js` (incremental, solo productos nuevos)
2. Ejecuta `node categorize.js`
3. Si `products.json` cambió, hace commit y push automático
4. El workflow `deploy.yml` se dispara y redespliega la web

### Forzar actualización manual

1. Ve a la pestaña **Actions** de tu repositorio en GitHub.
2. Selecciona el workflow **"Actualizar catálogo"**.
3. Haz clic en **"Run workflow"**.
4. Opcional: marca **"Forzar scraping completo"** para ignorar la caché y reescrapear todo.

---

## Añadir imágenes propias

Si quieres usar imágenes alojadas por ti mismo en lugar de las de Yupoo:

1. Guarda la imagen en la carpeta `images/` (ej: `images/12345.jpg`).
2. Edita `data/products.json` y modifica el campo `img` del producto correspondiente:

```json
{
  "id": "12345",
  "img": "./images/12345.jpg",
  ...
}
```

3. Haz commit y push. El workflow de despliegue actualizará la web.

> Las imágenes en `images/` se despliegan junto al resto del sitio en GitHub Pages.

---

## Estructura de precios

| Producto | Precio base |
|---|---|
| Camiseta normal | $8 |
| Camiseta retro | $13 |
| + Nombre y dorsal | +$3 |
| + Parche UCL | +$1 |
| + Parche Mundial 2026 | +$1 |
| + Brazalete Capitán | +$1 |

**Conversión a euros:** precio_usd × 0.90

### Cómo cambiar los precios

Edita `categorize.js`, función `getPrice()`:

```js
function getPrice(cat, name) {
  if (cat === 'retro' || name.toLowerCase().includes('retro')) return 13; // precio retro
  return 8; // precio normal
}
```

Para cambiar el extra de los parches o el nombre/dorsal, busca en `index.html`:

```js
if (document.getElementById('opt-dorsal').checked) usd += 3;  // nombre+dorsal
if (document.getElementById('opt-ucl').checked) usd += 1;     // UCL
if (document.getElementById('opt-wc').checked) usd += 1;      // Mundial
if (document.getElementById('opt-cap').checked) usd += 1;     // Capitán
```

El tipo de cambio EUR se ajusta en la constante `EUR_RATE` (por defecto `0.90`).

---

## Cambiar el email cuando esté disponible

Busca en `index.html` la línea:

```html
<span>Email: pedimoscamis@gmail.com</span>
```

Reemplázala por:

```html
<a href="mailto:TU_EMAIL@ejemplo.com">TU_EMAIL@ejemplo.com</a>
```

---

## Contacto

- **Email:** pedimoscamis@gmail.com

---

## Estructura del proyecto

```
kitzone/
├── index.html              # SPA completa (HTML + CSS + JS vanilla)
├── server.js               # Servidor Express local
├── scraper.js              # Extrae catálogo de Yupoo
├── categorize.js           # Categoriza y enriquece los productos
├── package.json
├── data/
│   ├── products-raw.json   # Datos crudos del scraper
│   └── products.json       # Catálogo final (lo lee la web)
├── images/                 # Imágenes propias (opcional)
└── .github/
    └── workflows/
        ├── update-catalog.yml  # Actualización diaria automática
        └── deploy.yml          # Despliegue en GitHub Pages
```
