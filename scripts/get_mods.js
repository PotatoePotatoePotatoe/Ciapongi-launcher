const axios = require('axios');

async function checkVersions(slug) {
  const res = await axios.get(`https://api.modrinth.com/v2/project/${slug}/version`, {
    headers: { 'User-Agent': 'Ciapongi-RP-Launcher' }
  });
  const v120 = res.data.filter(v => v.game_versions.includes('1.20.1') && v.loaders.includes('fabric'));
  console.log(`${slug} 1.20.1 versions count:`, v120.length);
  if (v120.length > 0) {
    const v = v120[0];
    const file = v.files.find(f => f.primary) || v.files[0];
    console.log('Latest 1.20.1 version:', v.version_number, file.filename, file.url);
  }
}

async function run() {
  await checkVersions('cull-less-leaves');
  await checkVersions('freecam');
  await checkVersions('badoptimizations');
}
run();
