---
name: desplegar-sitio
description: Publica PedimosCamis en producción (Cloudflare Pages vía GitHub Actions) y comprueba el resultado. Úsala cuando el usuario pida subir, desplegar o publicar cambios.
disable-model-invocation: true
---

# Desplegar

El deploy es automático con `push` a `main` (`.github/workflows/deploy.yml`). Solo se publica lo que el paso "Preparar sitio estático" copia: `index.html`, `manifest.webmanifest`, iconos, `data/products.json`, `p/*.html` (generadas) y `_headers` (noindex).

1. Ejecuta la skill `verificar-sitio`.
2. `git status` y `git diff --stat`: confirma que no se cuelan `.env`, `cloudflare.txt`, `data/products-raw.json` ni imágenes. Si hay cambios ajenos a la tarea (p. ej. `.claude/launch.json`, `deploy.yml`), no los añadas sin preguntar.
3. Si el cambio necesita un archivo nuevo en producción (imagen, JS, CSS externo), añádelo al paso de copia de `deploy.yml`.
4. Commit en español, descriptivo, y **pide confirmación antes de `git push`** (publica en pedimoscamis.com).
5. Tras el push: `gh run list --workflow deploy.yml --limit 1` y `gh run watch`. Verifica `https://pedimoscamis.com` y, si cambió el catálogo o un nombre, `https://pedimoscamis.com/p/<id>.html`.

No reactives el cron de `update-catalog.yml` (pisa las URLs de imagen con null). Cambios en `apps-script/` no se despliegan por aquí: hay que pegarlos y redesplegar en el editor de Apps Script.
