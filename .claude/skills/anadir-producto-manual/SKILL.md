---
name: anadir-producto-manual
description: Da de alta en data/products.json uno o varios productos que el usuario pasa a mano en la conversación (enlace de Yupoo, fotos locales o URLs, nombre), con fotos WebP en R2. Úsala para cualquier alta que no sea la importación automática de ggjersey.
---

# Alta manual de productos

Todo lo que no es la importación automática (`agent/update-catalog.js`) entra por `agent/add-manual.js`, que reutiliza el clasificador (`agent/parse.js`) y la subida a R2 (`agent/images.js`) del agente: el producto queda igual que uno importado.

## 1. Reunir los datos
Por cada producto hace falta:
- **title**: título en inglés al estilo del proveedor, con equipo, temporada y atributos (`Real Madrid 26/27 Home Women Fan Version`, `Barcelona 2008/09 Retro Away`, `Spain 2026 Kids Kit`). De él salen `cats`, `type`, precio y tallas. Será el `nameEn`.
- **Fotos**: `yupoo` (URL del álbum, de cualquier tienda `*.x.yupoo.com`: el id del producto pasa a ser el del álbum y se cogen la portada y las 3 siguientes) y/o `images` (rutas locales o URLs, portada primero; tienen prioridad sobre las de Yupoo). Mínimo 500 px de lado.
- Opcional: `nameEs` (si no se pone, se queda como `title`, como en el agente; la traducción se hace al mostrar con `NOMBRE_TRANSLATIONS`), `id`, `photos` (máximo de fotos, 4 por defecto), y solo si el clasificador no basta: `cats`, `priceUsd`, `sizes`.

Si falta algo imprescindible (equipo, temporada, tipo de equipación, fotos), pregunta al usuario en vez de inventarlo.

## 2. Escribir la especificación
Crea un JSON (un objeto o un array) en el scratchpad, no en el repo:
```json
[
  { "title": "Real Betis 26/27 Third Kids Kit", "nameEs": "Real Betis Tercera Niño 26/27",
    "yupoo": "https://ggjersey.x.yupoo.com/albums/254868323?uid=1" },
  { "title": "Boca Juniors 1981 Retro Home", "cats": ["retro", "sudamerica"],
    "images": ["C:/Users/Alfonso/Downloads/boca1.jpg", "C:/Users/Alfonso/Downloads/boca2.jpg"] }
]
```
Categorías válidas: `laliga premier seriea bundesliga ligue1 europa selecciones sudamerica nba otros shorts` + superpuestas `retro nuevatemporada women kids` (orden: `[retro?, liga, nuevatemporada?, women?, kids?]`). Precio por convención: 8 USD normal, 13 USD retro.

## 3. Simular
```bash
node agent/add-manual.js <spec.json> --dry-run
```
Muestra `cats`, `type`, precio, tallas y nº de fotos de cada uno, sin subir ni escribir. Errores habituales:
- **posible duplicado de <id>**: ya hay un producto con el mismo equipo + temporada + atributos. Enséñaselo al usuario; solo si confirma que es otro producto, repite con `--force`.
- **el clasificador no lo reconoce**: equipo fuera de `agent/teams.js` (Sudamérica, NBA, clubes pequeños…) o título sin temporada. Añade `cats` a mano o mejora el título. Si es un equipo que debería entrar también en el agente, añádelo a `teams.js` y ejecuta `npm run agent:test`.
- **el id ya existe**: ese álbum ya está en el catálogo.

Enseña al usuario la tabla de lo que se va a añadir antes de seguir.

## 4. Alta real
```bash
cp data/products.json data/products.json.bak
node agent/add-manual.js <spec.json>
```
Necesita `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` en `.env` (nunca en el código ni en la salida). Sube `mascamis/{id}_photoN_resultado.webp` y añade los productos al final de `products.json` sin tocar los existentes. Los ids sin álbum de Yupoo se generan como `mn` + 10 hex.

## 5. Comprobar y commitear
- `git diff --stat data/products.json`: solo líneas añadidas.
- `curl -o /dev/null -s -w "%{http_code}" <img>` de una portada nueva → 200.
- Ejecuta el skill `verificar-sitio` (busca el producto en el preview, o ábrelo con `?p=<id>`).
- Commit en español, p. ej. `Añadir Real Betis 26/27 Tercera Niño al catálogo`, y `push` a `main` (despliega en GitHub Pages) solo si el usuario lo pide.

## Retocar un producto ya añadido
El script solo da altas. Para corregir nombre, categorías, precio o tallas de un producto existente, edita su entrada en `data/products.json` con `node -e` (haz antes la copia `.bak`) y vuelve al paso 5. Para ocultarlo de destacadas usa `FEATURED_EXCLUDE_IDS` en `index.html` en lugar de borrarlo.
