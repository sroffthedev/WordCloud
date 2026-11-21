const http = require('http');
const apiHandler = require('./api/index.js');

const PORT = process.env.PORT || 3000;
const server = http.createServer(apiHandler);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`WordCloud server running on http://localhost:${PORT}`);
  });
}

// Vercel Node.js Server entrypoint accepts either an exported http.Server or request listener
module.exports = server;

