#!/usr/bin/env node
/* Сборка: всё в один index.html + файлы PWA рядом */

const fs = require('fs');
const path = require('path');

const SRC  = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');
fs.mkdirSync(DIST, { recursive: true });

const read = (p) => fs.readFileSync(p, 'utf8');

const css  = read(path.join(SRC, 'styles.css'));
const body = read(path.join(SRC, 'body.html'));

// Ключи проекта, если лежат рядом в supabase.config.json — вшиваем в сборку
let creds = null;
const credFile = path.join(__dirname, 'supabase.config.json');
if (fs.existsSync(credFile)) {
  try { creds = JSON.parse(read(credFile)); } catch (e) { console.warn('supabase.config.json не разобрался'); }
}

const jsDir = path.join(SRC, 'js');
const js = fs.readdirSync(jsDir)
  .filter(f => f.endsWith('.js'))
  .sort()
  .map(f => '/* ===== ' + f + ' ===== */\n' + read(path.join(jsDir, f)))
  .join('\n\n');

const jsFinal = creds && creds.url && creds.key
  ? js.replace(/const SUPABASE_URL = '[^']*';/, "const SUPABASE_URL = '" + creds.url + "';")
       .replace(/const SUPABASE_ANON_KEY = '[^']*';/, "const SUPABASE_ANON_KEY = '" + creds.key + "';")
  : js;

const favicon = fs.readFileSync(path.join(DIST, 'favicon.png')).toString('base64');

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no">
<title>Доход — учёт доходов и финансов</title>
<meta name="description" content="Личный учёт доходов, вкладов и кредитов">
<meta name="theme-color" content="#F4F6F5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#F4F6F5">
<meta name="color-scheme" content="light">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Доход">
<meta name="format-detection" content="telephone=no">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="icon" href="data:image/png;base64,${favicon}">
<style>
${css}
</style>
</head>
<body>
${body}
<script>
${jsFinal}
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(DIST, 'index.html'), html);
fs.copyFileSync(path.join(SRC, 'manifest.webmanifest'), path.join(DIST, 'manifest.webmanifest'));
fs.copyFileSync(path.join(SRC, 'sw.js'), path.join(DIST, 'sw.js'));

const kb = (n) => (n / 1024).toFixed(1) + ' КБ';
console.log('index.html   ' + kb(Buffer.byteLength(html)));
console.log('css          ' + kb(Buffer.byteLength(css)));
console.log('js           ' + kb(Buffer.byteLength(jsFinal)));
console.log(creds && creds.url ? 'проект       ' + creds.url + ' (вшит)' : 'проект       не задан — приложение спросит адрес');
