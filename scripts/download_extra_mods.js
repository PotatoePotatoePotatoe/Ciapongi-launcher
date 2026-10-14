const fs = require('fs');
const path = require('path');
const https = require('https');

const modsDir = 'E:/CIAPONGI LAUCHER/mods';

// 1. Clean PolishPlatform filename
const dirtyPlatform = path.join(modsDir, 'PolishPlatform-1.0.3-1.20.1(1) (1).jar');
const cleanPlatform = path.join(modsDir, 'PolishPlatform-1.0.3-1.20.1.jar');
if (fs.existsSync(dirtyPlatform)) {
  fs.renameSync(dirtyPlatform, cleanPlatform);
  console.log('Renamed PolishPlatform to clean name!');
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

async function run() {
  const downloads = [
    {
      name: 'Freecam',
      url: 'https://cdn.modrinth.com/data/XeEZ3fK2/versions/dKy60O1Y/freecam-fabric-1.2.1%2B1.20.jar',
      dest: path.join(modsDir, 'freecam-fabric-1.2.1+1.20.jar')
    },
    {
      name: 'Cull Less Leaves',
      url: 'https://cdn.modrinth.com/data/iG6ZHsUV/versions/4sXZok62/Cull%20Less%20Leaves-1.4.2%2B1.21-fabric.jar',
      dest: path.join(modsDir, 'cull-less-leaves-1.4.2+1.20.1-fabric.jar')
    },
    {
      name: 'BadOptimizations',
      url: 'https://cdn.modrinth.com/data/g96Z4WVZ/versions/DIugITgU/BadOptimizations-2.4.1-1.20.1.jar',
      dest: path.join(modsDir, 'BadOptimizations-2.4.1-1.20.1.jar')
    }
  ];

  for (const d of downloads) {
    if (!fs.existsSync(d.dest)) {
      console.log(`Downloading ${d.name}...`);
      await download(d.url, d.dest);
      console.log(`Downloaded ${d.name}!`);
    } else {
      console.log(`${d.name} already exists.`);
    }
  }
}

run().catch(console.error);
