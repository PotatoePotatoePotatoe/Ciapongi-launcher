const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function main() {
  const pngUrl = 'https://ciapongi.szablix.pl/instalacja/server-icon.png';
  const icoPath = path.join(__dirname, 'icon.ico');

  try {
    console.log('Pobieranie ikony PNG...');
    const response = await axios.get(pngUrl, { responseType: 'arraybuffer' });
    const pngBuffer = Buffer.from(response.data);
    const pngSize = pngBuffer.length;

    console.log('Generowanie pliku ICO...');
    const header = Buffer.alloc(22);
    
    // ICO Header
    header.writeUInt16LE(0, 0); // Reserved
    header.writeUInt16LE(1, 2); // Type (1 = Icon)
    header.writeUInt16LE(1, 4); // Number of images (1)
    
    // Directory Entry
    header.writeUInt8(0, 6); // Width (0 means 256)
    header.writeUInt8(0, 7); // Height (0 means 256)
    header.writeUInt8(0, 8); // Color count (0)
    header.writeUInt8(0, 9); // Reserved
    header.writeUInt16LE(1, 10); // Color planes (1)
    header.writeUInt16LE(32, 12); // Bits per pixel (32)
    header.writeUInt32LE(pngSize, 14); // Size of PNG data
    header.writeUInt32LE(22, 18); // Offset of PNG data (header size + directory entry size = 22)

    const icoBuffer = Buffer.concat([header, pngBuffer]);
    fs.writeFileSync(icoPath, icoBuffer);
    console.log('Pomyślnie utworzono icon.ico w:', icoPath);
  } catch (err) {
    console.error('Błąd tworzenia ikony:', err.message);
  }
}

main();
