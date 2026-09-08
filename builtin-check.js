#!/usr/bin/env node
/*
 * Проверка «только логин и пароль»: берём собранный index.html,
 * прогоняем через configure.js и убеждаемся, что приложение больше
 * не спрашивает адрес проекта.
 */

const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL_ = 'https://demo-project.supabase.co';
const KEY = 'a'.repeat(60);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dohod-'));
fs.copyFileSync(path.join(__dirname, 'dist', 'index.html'), path.join(tmp, 'index.html'));

const out = [];
const ok  = (n, d) => { out.push(true);  console.log('  ✓ ' + n + (d ? '  — ' + d : '')); };
const bad = (n, d) => { out.push(false); console.log('  ✗ ' + n + (d ? '  — ' + d : '')); };

(async () => {
  console.log('\n— Вшитый адрес проекта —');

  const res = execFileSync('node', [path.join(__dirname, 'configure.js'), URL_, KEY,
    path.join(tmp, 'index.html')], { encoding: 'utf8' });
  /Готово/.test(res) ? ok('configure.js прописал ключи', URL_)
                     : bad('configure.js прописал ключи', res);

  const html = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
  (html.includes("const SUPABASE_URL = '" + URL_ + "';") &&
   html.includes("const SUPABASE_ANON_KEY = '" + KEY + "';"))
    ? ok('Значения попали в файл')
    : bad('Значения попали в файл');

  const server = http.createServer((req, res) => {
    let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
    const f = path.join(tmp, p);
    if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU', deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Сеть до Supabase отсюда недоступна — клиент не загрузится, и это нормально:
  // проверяем именно интерфейс, а не соединение.
  await page.route('**/cdn.jsdelivr.net/**', r => r.abort());
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  await page.click('#tab-set');
  await page.waitForTimeout(300);

  const card = await page.evaluate(() => ({
    button: document.querySelector('#syncAuthLabel').textContent,
    sub: document.querySelector('#syncSub').textContent
  }));
  card.button === 'Войти'
    ? ok('Кнопка сразу предлагает вход', '«' + card.button + '» · ' + card.sub)
    : bad('Кнопка сразу предлагает вход', JSON.stringify(card));

  await page.click('#syncOpen');
  await page.waitForTimeout(420);

  const sheet = await page.evaluate(() => ({
    hasLogin: !!document.querySelector('#sy-login'),
    hasPass: !!document.querySelector('#sy-pass'),
    hasUrl: !!document.querySelector('#sy-url'),
    hasKey: !!document.querySelector('#sy-key'),
    labels: Array.from(document.querySelectorAll('#sheetBody .field-label')).map(n => n.textContent),
    buttons: Array.from(document.querySelectorAll('#sheetFoot button')).map(n => n.textContent)
  }));

  (sheet.hasLogin && sheet.hasPass && !sheet.hasUrl && !sheet.hasKey)
    ? ok('В листе только логин и пароль', sheet.labels.join(' + '))
    : bad('В листе только логин и пароль', JSON.stringify(sheet));

  (sheet.buttons.join('/') === 'Создать/Войти')
    ? ok('Кнопки: создать на первом телефоне, войти на втором', sheet.buttons.join(' · '))
    : bad('Кнопки входа', JSON.stringify(sheet.buttons));

  await page.evaluate(() => { const d = document.querySelector('#sheetBody details'); if (d) d.open = true; });
  await page.waitForTimeout(200);
  const disclosed = await page.evaluate(() => ({
    text: document.querySelector('#sheetBody .disclose-body p').textContent,
    hasDisconnect: /Отключить проект/.test(document.querySelector('#sheetBody').textContent)
  }));
  (/задан в файле/.test(disclosed.text) && !disclosed.hasDisconnect)
    ? ok('Адрес показан справочно и не отключается', disclosed.text)
    : bad('Адрес показан справочно и не отключается', JSON.stringify(disclosed));

  await page.screenshot({ path: path.join(__dirname, 'shots', 'sheet-login.png') });

  errors.length ? bad('Без ошибок', errors.slice(0, 2).join(' | ')) : ok('Без ошибок в консоли');

  console.log('\n— Итог —');
  const failed = out.filter(v => !v).length;
  console.log((out.length - failed) + ' из ' + out.length + ' проверок пройдено');

  await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
