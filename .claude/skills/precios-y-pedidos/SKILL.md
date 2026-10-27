---
name: precios-y-pedidos
description: Cambia precios, envío, cupones/códigos de socio o el flujo de pedidos (carrito, checkout, Apps Script, Google Sheet, correos, Mi cuenta) manteniendo frontend y backend sincronizados.
---

# Precios, cupones y pedidos

Frontend (`index.html`) y backend (`apps-script/*.gs`) comparten reglas; cambiar una sin la otra rompe cuentas del Sheet o correos.

## Dónde está cada cosa (busca con Grep por el nombre de la constante)
- Precios modo normal: `NORMAL_PRICES`, `NORMAL_JERSEY`, `NORMAL_RETRO`. Modo socio: `priceUsd` × `EUR_RATE`.
- Envío: `SHIPPING_COST` (lo que paga el cliente), `SHIPPING_REAL_COST` (coste real, columna del Sheet), `HOME_DELIVERY_EXTRA_COST` (tax aduana, coste sin cobro), `SHIPPING_FREE_AT`.
- Descuentos: `DISCOUNT_CODES`, `SOCIO_CODES`, `UCL_DISCOUNT`, `FLASH_SOURCES`, `SUPER_FLASH_ACTIVE/ID`. El uso de cupones se cuenta por dispositivo en `localStorage` (`promo_uses_<CODE>`).
- Pedido: `WEBHOOK_URL` → `doPost` en `apps-script/codigo-principal.gs`; cuentas y códigos de acceso en `apps-script/cuentas.gs`.

## Reglas ya acordadas (no las rompas)
- El cliente paga 5 € de envío a domicilio, el coste real es 4,50 €; en domicilio siempre se suman 2,66 € de coste (también con envío gratis). La fila "Tax aduana" va separada de "Gastos de envío" y se excluye de artículos, correos y Mi cuenta.
- "Mis pedidos" ordena por fecha descendente. Con sesión iniciada no se muestra "Sigue tu pedido" (el seguimiento es solo de Mi cuenta).
- Correos: nombre de remitente, reply-to, texto plano y asuntos sin emojis ni códigos.
- Entrega en mano: plazo 2-6 semanas.
- Segunda Estrella (`SECOND_STAR_PINNED`) no sube con el ajuste general de precios.

## Flujo
1. Edita `index.html` y, si el payload o los costes cambian, los `.gs` correspondientes (los campos del JSON de `doPost` deben coincidir).
2. Ejecuta `verificar-sitio` y prueba en el preview un carrito con envío, sin envío gratis y con ≥ `SHIPPING_FREE_AT` camisetas, con y sin código.
3. Avisa al usuario de que los `.gs` hay que pegarlos y redesplegar a mano en Apps Script (no hay clasp); no envíes pedidos de prueba al webhook real sin confirmación.
