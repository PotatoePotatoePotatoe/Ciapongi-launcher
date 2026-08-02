const process = require('process');

if (process.platform === 'win32') {
  require('./main-win.js');
} else {
  require('./main-linux.js');
}
