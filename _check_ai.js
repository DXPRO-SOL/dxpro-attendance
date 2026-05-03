const path = require('path');
const fs = require('fs');
const BASE_DIR = '/Users/user/dxpro-attendance/dxpro-attendance';

// routes/tasks.js の buildCodeActionPlan と同等ロジックをここで直接テスト
function readSrc(relPath) {
  try { return fs.readFileSync(path.join(BASE_DIR, relPath), 'utf8'); }
  catch { return ''; }
}

function extractRoutes(src) {
  const re = /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`\n]+)['"`]/g;
  const found = [];
  let m;
  while ((m = re.exec(src)) !== null) found.push(m[1].toUpperCase() + ' ' + m[2]);
  return found;
}

function extractSchemaFields(src, schemaVarName) {
  const startIdx = src.indexOf(schemaVarName + ' = new mongoose.Schema');
  if (startIdx < 0) return [];
  const braceIdx = src.indexOf('{', startIdx);
  let depth = 1, i = braceIdx + 1, block = '';
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    if (depth > 0) block += src[i];
    i++;
  }
  const fieldRe = /^\s{0,4}(\w+)\s*:/gm;
  const excl = ['type','default','required','ref','enum','min','max','index','unique','trim','sparse'];
  const fields = [];
  let fm;
  while ((fm = fieldRe.exec(block)) !== null) {
    if (!excl.includes(fm[1])) fields.push(fm[1]);
  }
  return [...new Set(fields)].slice(0, 12);
}

const modelsSrc = readSrc('models/index.js');
const attendanceSrc = readSrc('routes/attendance.js');
const chatSrc = readSrc('routes/chat.js');

console.log('=== 動作確認 ===');
console.log('models/index.js:', modelsSrc.length, 'bytes');
console.log('routes/attendance.js:', attendanceSrc.length, 'bytes');

const attRoutes = extractRoutes(attendanceSrc);
console.log('勤怠ルート:', attRoutes.slice(0, 5));

const attFields = extractSchemaFields(modelsSrc, 'AttendanceSchema');
console.log('AttendanceSchema fields:', attFields);

const chatFields = extractSchemaFields(modelsSrc, 'ChatMessageSchema');
console.log('ChatMessageSchema fields:', chatFields);

const goalFields = extractSchemaFields(modelsSrc, 'goalSchema');
console.log('goalSchema fields:', goalFields);

const chatRoutes = extractRoutes(chatSrc);
console.log('チャットルート:', chatRoutes.slice(0, 5));
