# Agente de catálogo

Añade al catálogo las novedades de `ggjersey.x.yupoo.com` (colección *New arrivals*, `/collections/5179824`).
Corre solo los días 1 y 15 de cada mes (`.github/workflows/update-catalog.yml`) y también a mano.

## Qué hace en cada ejecución
1. Recorre la colección de más nuevo a más viejo hasta llegar a lo ya visto (`data/catalog-agent-state.json`).
2. Clasifica cada título (`parse.js`). **Entra** solo: 5 grandes ligas, selecciones y los clubes europeos de `teams.js` (scope `europa`).
3. **No entra**: entrenamiento/chaquetas/shorts, NBA, clubes fuera de alcance, temporadas futuras (filtraciones) y duplicados. El retro y todas las temporadas sí entran.
4. **Lo dudoso no entra nunca**: equipo no reconocido, sin temporada, varios equipos en el título, resto raro tras el nombre del equipo. Queda en `data/catalog-agent-report.json` (`review`, `unknownTeams`).
5. Por producto nuevo: portada + 3 fotos siguientes (originales de 1200 px) → WebP q92 → R2 `mascamis/{id}_photoN_resultado.webp`.
6. Añade al final de `data/products.json` (nunca modifica lo existente) y lanza el despliegue.

Atributos extraídos del título: liga/selección, temporada (`nuevatemporada` = 26/27), `kids` (incl. bebé 9-12), `women`, manga larga, player version, portero, edición especial, crop. Tallas, `type` y precio siguen las reglas de `categorize.js`.

## Uso
```bash
npm run agent:test   # autotest: el clasificador contra el catálogo real + casos fijos
npm run agent:dry    # simula una ejecución completa (no descarga ni escribe)
npm run agent        # ejecución real (necesita R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY en .env)
```
Opciones: `--max-pages N` · `--max-new N` (freno: aborta si hay más) · `--limit N` · `--since-id ID`.

## Mantenimiento
- **Equipo nuevo / ascendido**: una línea en `teams.js`. Los desconocidos aparecen en el resumen de cada ejecución.
- **Tras tocar `teams.js` o `parse.js`**: `npm run agent:test` debe acabar con todos los casos fijos correctos.
- **Fallos de imagen**: el álbum se reintenta en las siguientes ejecuciones (máx. 3) y no se publica a medias.
