'use strict';
const fs   = require('fs');
const path = require('path');

const DIR = 'H:\\mascamis';

const files = fs.readdirSync(DIR).filter(f => /_photo1\.(jpg|jpeg|png|webp)$/i.test(f));

if (files.length === 0) {
  console.log('No hay archivos _photo1 que borrar.');
  process.exit(0);
}

console.log(`Borrando ${files.length} archivos _photo1...\n`);
for (const f of files) {
  fs.unlinkSync(path.join(DIR, f));
  console.log(`  ✗ ${f}`);
}
console.log(`\nListo. ${files.length} archivos eliminados.`);
