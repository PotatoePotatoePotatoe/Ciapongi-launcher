const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const appBaseDir = process.env.PORTABLE_EXECUTABLE_DIR
  ? process.env.PORTABLE_EXECUTABLE_DIR
  : (app.isPackaged ? app.getPath('userData') : app.getAppPath());

const logPath = path.join(appBaseDir, 'launcher-latest.log');

function logToFile(message) {
  try {
    fs.appendFileSync(logPath, message + '\n', 'utf8');
  } catch (err) {
    console.error("Błąd zapisu logu do pliku:", err);
  }
}

function calculateHash(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve(null);
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => resolve(null));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function findPackRoot(dir) {
  const items = fs.readdirSync(dir);
  if (items.includes('mods') || items.includes('config') || items.includes('launcher-config.json')) {
    return dir;
  }
  for (const item of items) {
    const fullPath = path.join(dir, item);
    if (fs.statSync(fullPath).isDirectory()) {
      const subRoot = findPackRoot(fullPath);
      if (subRoot) return subRoot;
    }
  }
  return null;
}

function isPackFullyInstalled(gameDir) {
  const manifestPath = path.join(gameDir, 'pack-manifest.json');
  const modsDir = path.join(gameDir, 'mods');
  return fs.existsSync(manifestPath) && fs.existsSync(modsDir);
}

function findJavaExecutable(dir) {
  if (!fs.existsSync(dir)) return null;
  const items = fs.readdirSync(dir);
  const isWin = process.platform === 'win32';
  const matchName = isWin ? 'java.exe' : 'java';

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const found = findJavaExecutable(fullPath);
      if (found) return found;
    } else if (item.toLowerCase() === matchName) {
      return fullPath;
    }
  }
  return null;
}

function copyDirRecursive(src, dest, relativeList = [], baseDest = dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (['saves', 'screenshots', 'logs'].includes(entry.name.toLowerCase())) {
        continue;
      }
      copyDirRecursive(srcPath, destPath, relativeList, baseDest);
    } else {
      fs.copyFileSync(srcPath, destPath);
      const rel = path.relative(baseDest, destPath).replace(/\\/g, '/');
      relativeList.push(rel);
    }
  }
  return relativeList;
}

module.exports = {
  logToFile,
  calculateHash,
  findPackRoot,
  isPackFullyInstalled,
  findJavaExecutable,
  copyDirRecursive
};
