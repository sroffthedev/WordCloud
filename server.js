// Compatibility shim if Vercel or local runner points to server.js: exports the Vercel request handler
module.exports = require('./api/index.js');
