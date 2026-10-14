const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const modsDir = 'E:/CIAPONGI LAUCHER/mods';
const files = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));

console.log(`Total jar files in mods dir: ${files.length}`);
const modInfo = [];

for (const file of files) {
  const fullPath = path.join(modsDir, file);
  try {
    const zip = new AdmZip(fullPath);
    const entry = zip.getEntry('fabric.mod.json');
    if (entry) {
      const data = JSON.parse(entry.getData().toString('utf8'));
      modInfo.push({
        file,
        id: data.id,
        name: data.name || data.id,
        version: data.version
      });
    } else {
      modInfo.push({ file, id: null, name: file, version: null });
    }
  } catch (err) {
    modInfo.push({ file, id: null, name: file, error: err.message });
  }
}

console.log(JSON.stringify(modInfo, null, 2));
