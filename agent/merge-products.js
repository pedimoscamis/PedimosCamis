#!/usr/bin/env node
'use strict';
/**
 * Reaplica las altas del agente sobre el data/products.json actual de main.
 *
 * El agente tarda ~40 min; si mientras tanto alguien sube cambios a products.json,
 * un rebase de git choca (el archivo es un único array JSON). En su lugar se parte
 * del products.json más reciente y se añaden al final solo los productos que el
 * agente dio de alta (ids de report.addedItems) y que aún no estén.
 *
 * Uso: node agent/merge-products.js <products.json del agente> <catalog-agent-report.json>
 */
const fs = require('fs');
const path = require('path');

const [agentFile, reportFile] = process.argv.slice(2);
if (!agentFile || !reportFile) { console.error('Uso: merge-products.js <products-agente.json> <report.json>'); process.exit(2); }

const PRODUCTS_FILE = path.join(__dirname, '..', 'data', 'products.json');
const agentProducts = JSON.parse(fs.readFileSync(agentFile, 'utf8'));
const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
const raw = fs.readFileSync(PRODUCTS_FILE, 'utf8');
const current = JSON.parse(raw);
if (!Array.isArray(current) || current.length < 1000) throw new Error('products.json de main ilegible o sospechosamente pequeño');

const addedIds = new Set((report.addedItems || []).map(a => String(a.id)));
const currentIds = new Set(current.map(p => String(p.id)));
const toAppend = agentProducts.filter(p => addedIds.has(String(p.id)) && !currentIds.has(String(p.id)));

if (toAppend.length) {
  const out = JSON.stringify(current.concat(toAppend), null, 2) + (raw.endsWith('\n') ? '\n' : '');
  fs.writeFileSync(PRODUCTS_FILE, out);
}
console.log(`Altas del agente: ${addedIds.size} · añadidas sobre main: ${toAppend.length} · ya presentes: ${addedIds.size - toAppend.length}`);
