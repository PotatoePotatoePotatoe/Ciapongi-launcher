const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const modsDir = 'E:/CIAPONGI LAUCHER/mods';
const files = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));

const hashMap = new Map();
const hashes = [];

for (const file of files) {
  const buf = fs.readFileSync(path.join(modsDir, file));
  const hash = crypto.createHash('sha1').update(buf).digest('hex');
  hashMap.set(hash, file);
  hashes.push(hash);
}

console.log(`Checking ${hashes.length} mods against Modrinth update API...`);

axios.post('https://api.modrinth.com/v2/version_files/update', {
  hashes: hashes,
  algorithm: 'sha1',
  game_versions: ['1.20.1'],
  loaders: ['fabric']
}, {
  headers: { 'User-Agent': 'Ciapongi-RP-Launcher' }
}).then(res => {
  const updates = [];
  for (const [oldHash, newVersion] of Object.entries(res.data)) {
    const oldFile = hashMap.get(oldHash);
    const newFile = newVersion.files.find(f => f.primary) || newVersion.files[0];
    if (newFile.hashes.sha1 !== oldHash) {
      updates.push({
        oldFile,
        newFile: newFile.filename,
        newVersion: newVersion.version_number,
        url: newFile.url
      });
    }
  }
  console.log(`Found ${updates.length} updates:`);
  updates.forEach(u => console.log(`- ${u.oldFile} -> ${u.newFile} (${u.newVersion})`));
}).catch(err => {
  console.error('Error:', err.message);
});
