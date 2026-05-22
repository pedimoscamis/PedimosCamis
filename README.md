> ⚠️ **Aviso Legal / Disclaimer:** Este repositorio y la página web asociada son un proyecto personal de desarrollo web creado exclusivamente con fines educativos, experimentales y de portfolio. **NO es una tienda real**. Este proyecto no tiene fines comerciales, no realiza ventas, no procesa pagos reales y no representa ni está afiliado a ninguna marca, empresa u organización oficial.

---

## 💻 Sobre el Proyecto

**PedimosCamis** es una simulación completa de un e-commerce construida como una Single Page Application (SPA) utilizando **JavaScript Vanilla**. El objetivo principal de este proyecto es demostrar habilidades en la estructuración de aplicaciones web sin depender de frameworks pesados, manejando el estado del cliente, la manipulación del DOM y las interacciones asíncronas desde cero.

## ✨ Características Técnicas (Simulación)

* **Arquitectura Zero-Dependency:** Frontend construido 100% con HTML5, CSS3 y JavaScript moderno (ES6+), demostrando control total sobre el rendimiento y la lógica del navegador.
* **Gestión de Estado Dinámica:** Sistema propio para el manejo del catálogo, filtrado de productos y un carrito de compras complejo (agrupación por ID y variantes, cálculo de subtotales).
* **UI/UX Interactiva:**
    * Interfaz visual estructurada en filas deslizables (estilo "Netflix") para la exhibición de productos.
    * Modales interactivos para la selección de variables (talla, versión, personalización).
    * Efectos visuales y animaciones avanzadas mediante CSS puro (`@keyframes`, pseudo-elementos).
* **Simulación de Checkout y Backend:**
    * Formulario de validación de pedidos en el lado del cliente.
    * Integración asíncrona (`Fetch API`) con un Webhook (Google Apps Script) para simular el registro de datos en un backend serverless y disparar correos de prueba en formato HTML.
* **Diseño Responsivo:** Patrón *Mobile First* para asegurar que la interfaz fluya perfectamente en cualquier dispositivo.

## 🛠️ Tecnologías Empleadas

* **Frontend:** HTML5, CSS3 (Variables, Flexbox, Grid), Vanilla JS.
* **Alojamiento de assets:** Cloudinary CDN.
* **Backend Simulado:** Google Apps Script (Procesamiento de JSON a través de endpoints `doPost`).
* **Control de Versiones:** Git & GitHub.

## 💡 Lógica del Flujo (Frontend)

1. **Renderizado:** El catálogo se inyecta dinámicamente en el DOM a partir de una base de datos local en formato JSON (*Mock Data*).
2. **Interacción:** El usuario puede filtrar categorías, ver detalles y configurar parámetros específicos de un artículo simulado.
3. **Manejo del Carrito:** Los arrays de datos se actualizan en tiempo real, reflejando cantidades y sumatorios visuales.
4. **Envío de Datos:** Al finalizar, el sistema empaqueta un payload JSON estructurado y realiza una petición POST al script de Google para registrar la interacción.

## 📝 Roadmap / Futuras Mejoras de Código

* [ ] Implementación de *Fuzzy Search* para optimizar el motor de búsqueda interno.
* [ ] Refactorización de la base de datos Mock a un entorno Firebase o MongoDB.
* [ ] Soporte de internacionalización (i18n) simulado.
* [ ] Optimización de carga de imágenes (Lazy Loading nativo).

---
*Desarrollado como proyecto personal para la exploración y mejora de técnicas de programación frontend.*
