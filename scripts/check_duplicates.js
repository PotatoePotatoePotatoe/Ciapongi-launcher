const fs = require('fs');
const path = require('path');

const modsDir = 'E:/CIAPONGI LAUCHER/mods';
const files = fs.readdirSync(modsDir);

console.log('--- DUPLICATES & ANOMALIES IN E:/CIAPONGI LAUCHER/mods ---');
files.forEach(f => {
  if (f.endsWith('.disabled')) {
    console.log('Disabled mod:', f);
  }
  if (f.includes('(1)') || f.includes('(2)') || f.includes('copy')) {
    console.log('Duplicate filename marker:', f);
  }
});

// Group by base name to find version duplicates
const map = new Map();
files.forEach(f => {
  const clean = f.replace(/\.disabled$/i, '').replace(/[\s\-_]+v?\d.*\.jar$/i, '').toLowerCase();
  if (!map.has(clean)) map.set(clean, []);
  map.get(clean).push(f);
});

console.log('\n--- POTENTIAL DUPLICATE MODS ---');
for (const [name, list] of map.entries()) {
  if (list.length > 1) {
    console.log(`${name}:`, list);
  }
}
