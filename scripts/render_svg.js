const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      offscreen: true
    }
  });

  const svgPath = path.join(__dirname, 'ciapongi_icon.svg');
  const svgData = fs.readFileSync(svgPath, 'utf8');
  const html = `<!DOCTYPE html>
  <html>
    <head>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 1024px; height: 1024px; background: transparent; overflow: hidden; }
        svg { width: 1024px; height: 1024px; display: block; }
      </style>
    </head>
    <body>
      ${svgData}
    </body>
  </html>`;

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 600));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const pngBuffer = image.toPNG();
  const outPath = path.join(__dirname, '..', 'icon_rendered.png');
  fs.writeFileSync(outPath, pngBuffer);
  console.log('Successfully captured rendered icon! Size:', pngBuffer.length);
  app.exit(0);
});
