const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

const DIM   = '\x1b[2m';
const GREEN = '\x1b[32m';
const BOLD  = '\x1b[1m';
const RESET = '\x1b[0m';
const RED   = '\x1b[31m';

function dbLog(mark, msg) {
  const ts = new Date().toISOString().replace('T',' ').substring(0,23);
  console.log(`${DIM}${ts}${RESET}  ${mark}  ${msg}`);
}

dbLog(`${DIM}[DB]${RESET}`, `Connecting to MongoDB Atlas ...`);
dbLog(`${DIM}[DB]${RESET}`, `URI: ${MONGODB_URI ? MONGODB_URI.replace(/:([^@]+)@/, ':****@') : '(not set)'}`);

mongoose.connect(MONGODB_URI)
    .then(() => {
      dbLog(`${GREEN}${BOLD}  ✔  ${RESET}`, `MongoDB Atlas connected successfully`);
    })
    .catch(err => {
      dbLog(`${RED}${BOLD}  ✖  ${RESET}`, `MongoDB connection FAILED: ${err.message}`);
    });

module.exports = mongoose;
