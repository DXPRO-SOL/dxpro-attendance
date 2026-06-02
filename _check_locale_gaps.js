const en = require('./locales/en.json');
const ja = require('./locales/ja.json');
const ko = require('./locales/ko.json');
const vi = require('./locales/vi.json');
const zh = require('./locales/zh.json');

function getKeys(obj, prefix) {
  prefix = prefix || '';
  let keys = [];
  for (const k of Object.keys(obj)) {
    if (typeof obj[k] === 'object' && obj[k] !== null) {
      keys = keys.concat(getKeys(obj[k], prefix ? prefix+'.'+k : k));
    } else {
      keys.push(prefix ? prefix+'.'+k : k);
    }
  }
  return keys;
}

const enKeys = new Set(getKeys(en));
const jaKeys = new Set(getKeys(ja));
const koKeys = new Set(getKeys(ko));
const viKeys = new Set(getKeys(vi));
const zhKeys = new Set(getKeys(zh));

const missing_ko = getKeys(en).filter(function(k){ return !koKeys.has(k); });
const missing_vi = getKeys(en).filter(function(k){ return !viKeys.has(k); });
const missing_zh = getKeys(en).filter(function(k){ return !zhKeys.has(k); });
const missing_en_from_ja = getKeys(ja).filter(function(k){ return !enKeys.has(k); });
const missing_ko_from_ja = getKeys(ja).filter(function(k){ return !koKeys.has(k); });
const missing_vi_from_ja = getKeys(ja).filter(function(k){ return !viKeys.has(k); });
const missing_zh_from_ja = getKeys(ja).filter(function(k){ return !zhKeys.has(k); });

console.log('Keys in EN but missing in KO:', missing_ko.length);
console.log('Keys in EN but missing in VI:', missing_vi.length);
console.log('Keys in EN but missing in ZH:', missing_zh.length);
console.log('Keys in JA but missing in EN:', missing_en_from_ja.length);
console.log('Keys in JA but missing in KO:', missing_ko_from_ja.length);
console.log('Keys in JA but missing in VI:', missing_vi_from_ja.length);
console.log('Keys in JA but missing in ZH:', missing_zh_from_ja.length);

console.log('\n--- Missing in EN (from JA) ---');
missing_en_from_ja.forEach(function(k){ console.log(k); });

console.log('\n--- Missing in KO (from JA) ---');
missing_ko_from_ja.forEach(function(k){ console.log(k); });
