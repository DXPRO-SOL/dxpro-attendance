const ja = require('./locales/ja.json');
const en = require('./locales/en.json');
const ko = require('./locales/ko.json');
const vi = require('./locales/vi.json');
const zh = require('./locales/zh.json');

const sections = ['overtime', 'admin_page', 'leave', 'contracts', 'workflow', 'hr_portal'];
sections.forEach(function(s) {
  const jaSection = ja[s] || {};
  const enSection = en[s] || {};
  const koSection = ko[s] || {};
  const viSection = vi[s] || {};
  const zhSection = zh[s] || {};

  const missingEn = Object.keys(jaSection).filter(function(k) { return enSection[k] === undefined; });
  const missingKo = Object.keys(jaSection).filter(function(k) { return koSection[k] === undefined; });
  const missingVi = Object.keys(jaSection).filter(function(k) { return viSection[k] === undefined; });
  const missingZh = Object.keys(jaSection).filter(function(k) { return zhSection[k] === undefined; });

  if (missingEn.length || missingKo.length || missingVi.length || missingZh.length) {
    console.log('=== ' + s + ' ===');
    if (missingEn.length) console.log('  Missing EN (' + missingEn.length + '):', missingEn.join(', '));
    if (missingKo.length) console.log('  Missing KO (' + missingKo.length + '):', missingKo.join(', '));
    if (missingVi.length) console.log('  Missing VI (' + missingVi.length + '):', missingVi.join(', '));
    if (missingZh.length) console.log('  Missing ZH (' + missingZh.length + '):', missingZh.join(', '));
  }
});
