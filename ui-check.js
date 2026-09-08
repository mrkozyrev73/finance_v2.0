#!/usr/bin/env node
/*
 * Точечные проверки двух правок:
 *  — длинное название помещается внутрь кольца структуры;
 *  — быстрые категории идут одной строкой с прокруткой,
 *    недавно использованные впереди.
 */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildSeed } = require('./seed');

const DIST = path.join(__dirname, 'dist');
const SHOTS = path.join(__dirname, 'shots');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/json', '.png': 'image/png' };

const out = [];
const ok  = (n, d) => { out.push(true);  console.log('  ✓ ' + n + (d ? '  — ' + d : '')); };
const bad = (n, d) => { out.push(false); console.log('  ✗ ' + n + (d ? '  — ' + d : '')); };

(async () => {
  const server = http.createServer((req, res) => {
    let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
    const f = path.join(DIST, p);
    if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    locale: 'ru-RU', timezoneId: 'Europe/Samara', hasTouch: true, isMobile: true
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.addInitScript(s => localStorage.setItem('dohod.state.v1', JSON.stringify(s)), buildSeed());
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  console.log('\n— Кольцо структуры —');

  // Месяц 2024, где есть только «Ранее заработанное» — самое длинное название
  await page.evaluate(() => MonthBar.setKey('2024-05'));
  await page.click('#tab-stats');
  await page.waitForTimeout(600);

  const donut = await page.evaluate(() => {
    const wrap = document.querySelector('.donut-wrap').getBoundingClientRect();
    const k = document.querySelector('#donutTopName');
    const v = document.querySelector('#donutTopShare');
    const kb = k.getBoundingClientRect();
    const cs = getComputedStyle(k);
    // Внутренний край кольца: r=41 при толщине 13 → 34.5 из 50 полуширины
    const innerR = wrap.width * (34.5 / 50) / 2;
    const cx = wrap.left + wrap.width / 2, cy = wrap.top + wrap.height / 2;
    // Меряем реальные прямоугольники строк текста, а не блок-контейнер
    const corners = [];
    for (const node of [k, v]) {
      const r = document.createRange();
      r.selectNodeContents(node);
      for (const b of r.getClientRects()) {
        corners.push([b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]);
      }
    }
    return {
      name: k.textContent,
      lines: Math.round(kb.height / (parseFloat(cs.lineHeight) || 13)),
      fontSize: cs.fontSize,
      innerR: Math.round(innerR),
      worst: Math.round(Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)))),
      clipped: k.scrollWidth > k.clientWidth + 1 && kb.height < 20
    };
  });

  (donut.name === 'Ранее заработанное' && donut.lines === 2 && donut.worst <= donut.innerR + 1)
    ? ok('Длинное название умещается в кольцо',
         '«' + donut.name + '» в 2 строки, ' + donut.fontSize + ', радиус ' + donut.worst + '/' + donut.innerR)
    : bad('Длинное название умещается в кольцо', JSON.stringify(donut));

  await page.evaluate(() => window.scrollTo(0, 760));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, 'donut.png') });

  console.log('\n— Быстрые категории в форме —');

  await page.evaluate(() => MonthBar.setKey(View.todayKey));
  await page.click('#tab-home');
  await page.waitForTimeout(300);
  await page.click('#addIncome');
  await page.waitForTimeout(600);

  const quick = await page.evaluate(() => {
    const row = document.querySelector('.quick-cats');
    const items = Array.from(row.querySelectorAll('.quick-cat'));
    const tops = new Set(items.map(b => Math.round(b.getBoundingClientRect().top)));
    return {
      count: items.length,
      names: items.map(b => b.textContent),
      oneLine: tops.size === 1,
      scrollable: row.scrollWidth > row.clientWidth + 4,
      overflowX: getComputedStyle(row).overflowX,
      hasBorder: getComputedStyle(items[0]).borderTopWidth,
      hasDot: getComputedStyle(items[0], '::before').width,
      fits: items.every(b => b.getBoundingClientRect().height <= 36)
    };
  });

  const recent = await page.evaluate(() => Data.recentCategories().map(c => c.name));
  const expectedRecent = await page.evaluate(() => {
    const seen = [];
    for (const r of Store.list('incomes').slice().sort((a, b) => b.createdAt - a.createdAt)) {
      const n = Data.categoryName(r.categoryId);
      if (!seen.includes(n) && n !== 'Без категории') seen.push(n);
    }
    return seen;
  });

  (quick.oneLine && quick.scrollable && quick.overflowX === 'auto' && quick.count === 13)
    ? ok('Одна строка с прокруткой', quick.count + ' категорий, ширина ' + (quick.scrollable ? 'больше экрана' : '—'))
    : bad('Одна строка с прокруткой', JSON.stringify(quick));

  (quick.hasBorder === '0px' && quick.hasDot !== 'auto' && quick.hasDot !== '0px')
    ? ok('Не бордюрные плашки, а точка цвета категории', 'border ' + quick.hasBorder + ', точка ' + quick.hasDot)
    : bad('Не бордюрные плашки', JSON.stringify({ border: quick.hasBorder, dot: quick.hasDot }));

  (quick.names.slice(0, expectedRecent.length).join('|') === expectedRecent.join('|'))
    ? ok('Недавно использованные — первыми', quick.names.slice(0, 4).join(', ') + '…')
    : bad('Недавно использованные — первыми', JSON.stringify({ got: quick.names.slice(0, 5), want: expectedRecent }));

  const fade = await page.evaluate(() => {
    const wrap = document.querySelector('.quick-wrap');
    const cs = getComputedStyle(wrap, '::after');
    return { more: wrap.hasAttribute('data-more'), opacity: cs.opacity, width: cs.width };
  });
  (fade.more && parseFloat(fade.opacity) > 0.9)
    ? ok('Видна подсказка, что строка продолжается', 'градиент ' + fade.width)
    : bad('Видна подсказка, что строка продолжается', JSON.stringify(fade));

  // Прокрутка вправо действительно работает
  await page.evaluate(() => { document.querySelector('.quick-cats').scrollLeft = 9999; });
  await page.waitForTimeout(260);
  const scrolled = await page.evaluate(() => {
    const row = document.querySelector('.quick-cats');
    return { left: Math.round(row.scrollLeft), max: Math.round(row.scrollWidth - row.clientWidth) };
  });
  (scrolled.left > 40 && scrolled.left >= scrolled.max - 2)
    ? ok('Строка листается до конца', scrolled.left + ' из ' + scrolled.max + ' px')
    : bad('Строка листается до конца', JSON.stringify(scrolled));

  await page.evaluate(() => { document.querySelector('.quick-cats').scrollLeft = 0; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, 'form.png') });

  // Выбор категории через выпадающий список подкручивает строку к выбранной
  await page.selectOption('#f-cat', { label: 'Кешбек сервисы' });
  await page.waitForTimeout(400);
  const picked = await page.evaluate(() => {
    const row = document.querySelector('.quick-cats');
    const active = row.querySelector('.quick-cat[aria-pressed="true"]');
    const rb = row.getBoundingClientRect(), ab = active.getBoundingClientRect();
    return { name: active.textContent, visible: ab.left >= rb.left - 1 && ab.right <= rb.right + 1 };
  });
  (picked.name === 'Кешбек сервисы' && picked.visible)
    ? ok('Выбор из списка подкручивает строку к нужной', picked.name)
    : bad('Выбор из списка подкручивает строку', JSON.stringify(picked));

  errors.length ? bad('Без ошибок в консоли', errors.slice(0, 2).join(' | ')) : ok('Без ошибок в консоли');

  console.log('\n— Итог —');
  const failed = out.filter(v => !v).length;
  console.log((out.length - failed) + ' из ' + out.length + ' проверок пройдено');

  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
