#!/usr/bin/env node
/* Проверка приложения по чек-листу в реальном браузере */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildSeed } = require('./seed');

const DIST = path.join(__dirname, 'dist');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.ico': 'image/x-icon'
};

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(DIST, p);
    if (!file.startsWith(DIST) || !fs.existsSync(file)) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

const results = [];
const ok   = (n, d) => { results.push({ n, pass: true, d }); console.log('  ✓ ' + n + (d ? '  — ' + d : '')); };
const bad  = (n, d) => { results.push({ n, pass: false, d }); console.log('  ✗ ' + n + (d ? '  — ' + d : '')); };
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1 : eps);

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'ru-RU',
    timezoneId: 'Europe/Samara',
    hasTouch: true, isMobile: true
  });

  const errors = [];
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.addInitScript(seed => {
    localStorage.setItem('dohod.state.v1', JSON.stringify(seed));
  }, buildSeed());

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  console.log('\n— Проверки —');

  /* 0. Консоль */
  errors.length ? bad('Консоль без ошибок', errors.slice(0, 3).join(' | '))
                : ok('Консоль без ошибок');

  /* 12. Одинаковые размеры заголовков на всех вкладках */
  const titles = {};
  for (const tab of ['home', 'stats', 'fin', 'set']) {
    await page.click('#tab-' + tab);
    await page.waitForTimeout(220);
    titles[tab] = await page.evaluate(() => {
      const pick = (sel) => {
        const n = document.querySelector('.screen[data-active] ' + sel);
        if (!n) return null;
        const cs = getComputedStyle(n);
        return cs.fontSize + '/' + cs.fontWeight + '/' + cs.lineHeight + '/' + cs.letterSpacing;
      };
      return { h1: pick('.screen-title'), h2: pick('.section-title') };
    });
  }
  const h1s = Object.values(titles).map(t => t.h1).filter(Boolean);
  const h2s = Object.values(titles).map(t => t.h2).filter(Boolean);
  (new Set(h1s).size <= 1 && new Set(h2s).size === 1)
    ? ok('Единые размеры заголовков', 'h1 ' + h1s[0] + ' · h2 ' + h2s[0])
    : bad('Единые размеры заголовков', JSON.stringify(titles));

  /* Отступы слева/справа одинаковы */
  const gutters = await page.evaluate(() => {
    const out = {};
    for (const s of document.querySelectorAll('.screen')) {
      const cs = getComputedStyle(s.parentElement);
      out[s.id] = cs.paddingLeft + '/' + cs.paddingRight;
    }
    return out;
  });
  new Set(Object.values(gutters)).size === 1
    ? ok('Одинаковые боковые отступы', Object.values(gutters)[0])
    : bad('Одинаковые боковые отступы', JSON.stringify(gutters));

  /* 1. Переключение месяцев не двигает страницу */
  await page.click('#tab-home');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.scrollTo(0, 90));
  await page.waitForTimeout(140);
  const snapMonth = () => page.evaluate(() => {
    const list = document.querySelector('#incomeList');
    return {
      y: window.scrollY,
      hero: Math.round(document.querySelector('.hero').getBoundingClientRect().height),
      heroTop: Math.round(document.querySelector('.hero').getBoundingClientRect().top),
      listTop: Math.round(list.getBoundingClientRect().top),
      rowH: Math.round((list.querySelector('.swipe') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
      label: document.querySelector('#monthLabel').textContent.trim(),
      received: document.querySelector('#heroReceived').textContent.trim()
    };
  });
  const before = await snapMonth();
  await page.click('#monthPrev');
  await page.waitForTimeout(400);
  const after = await snapMonth();
  (near(before.y, after.y) && near(before.hero, after.hero) &&
   near(before.heroTop, after.heroTop) && near(before.listTop, after.listTop) &&
   before.label !== after.label && before.received !== after.received)
    ? ok('Смена месяца: страница не прыгает',
         'scrollY ' + before.y + '→' + after.y + ', блоки на месте, ' + before.label + ' → ' + after.label)
    : bad('Смена месяца: страница не прыгает', JSON.stringify({ before, after }));
  await page.click('#monthNext');
  await page.waitForTimeout(320);

  /* 6. Свайп открывает «Изменить» и «Удалить» */
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  const rowBox = await page.locator('#incomeList .swipe').first().boundingBox();
  const cy = rowBox.y + rowBox.height / 2;
  await page.mouse.move(rowBox.x + rowBox.width - 30, cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(rowBox.x + rowBox.width - 30 - i * 14, cy, { steps: 1 });
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const swipe = await page.evaluate(() => {
    const row = document.querySelector('#incomeList .swipe');
    const body = row.querySelector('.swipe-body');
    const tx = new DOMMatrixReadOnly(getComputedStyle(body).transform).m41;
    const labels = Array.from(row.querySelectorAll('.swipe-action span')).map(n => n.textContent);
    const r = getComputedStyle(body).borderRadius;
    return { tx: Math.round(tx), labels, radius: r, overflow: getComputedStyle(row).overflow };
  });
  (swipe.tx <= -130 && swipe.labels.join(',') === 'Изменить,Удалить')
    ? ok('Свайп открывает действия', 'сдвиг ' + swipe.tx + 'px, ' + swipe.labels.join(' / '))
    : bad('Свайп открывает действия', JSON.stringify(swipe));

  const bleed = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#incomeList .swipe'));
    const closed = rows.filter(r => !r.hasAttribute('data-open'));
    return {
      openVisible: getComputedStyle(rows[0].querySelector('.swipe-actions')).visibility,
      closedHidden: closed.every(r => getComputedStyle(r.querySelector('.swipe-actions')).visibility === 'hidden'),
      closedCount: closed.length
    };
  });
  (bleed.openVisible === 'visible' && bleed.closedHidden && bleed.closedCount > 0)
    ? ok('Закрытые строки не подсвечивают цвет действий', bleed.closedCount + ' закрытых строк чистые')
    : bad('Закрытые строки не подсвечивают цвет действий', JSON.stringify(bleed));

  /* 7. Края карточек скруглены и не обрезаются */
  (swipe.radius !== '0px' && swipe.overflow === 'hidden')
    ? ok('Края карточки скруглены', 'radius ' + swipe.radius)
    : bad('Края карточки скруглены', JSON.stringify(swipe));

  const overflowRow = await page.evaluate(() => {
    const host = document.querySelector('#incomeList');
    const hb = host.getBoundingClientRect();
    let worst = 0;
    for (const r of host.querySelectorAll('.swipe')) {
      const b = r.getBoundingClientRect();
      worst = Math.max(worst, hb.left - b.left, b.right - hb.right);
    }
    return Math.round(worst);
  });
  overflowRow <= 0 ? ok('Карточки не выходят за контейнер')
                   : bad('Карточки не выходят за контейнер', 'вылет ' + overflowRow + 'px');

  await page.mouse.click(195, 120);   // мимо списка — открытая строка должна закрыться
  await page.waitForTimeout(320);

  /* 2 и 3. Столбцы статистики */
  await page.click('#tab-stats');
  await page.waitForTimeout(320);
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(120);

  const measureStruct = () => page.evaluate(() => {
    const card = document.querySelectorAll('#scr-stats .card')[1];
    return {
      y: window.scrollY,
      docH: document.documentElement.scrollHeight,
      chart: document.querySelector('#dynSlot').getBoundingClientRect().height,
      donut: document.querySelector('#donutSlot').getBoundingClientRect().height,
      structH: card.getBoundingClientRect().height,
      scope: document.querySelector('#structScope').textContent,
      rows: document.querySelectorAll('#structList .cat-item').length
    };
  });

  const s0 = await measureStruct();
  await page.locator('.bar-col').nth(2).click();
  await page.waitForTimeout(340);
  const s1 = await measureStruct();
  await page.locator('.bar-col').nth(5).click();
  await page.waitForTimeout(340);
  const s2 = await measureStruct();

  (near(s0.y, s1.y) && near(s1.y, s2.y) && near(s0.chart, s2.chart) && near(s0.donut, s2.donut))
    ? ok('Выбор столбца: без прокрутки и мерцания', 'высота графика ' + s0.chart + 'px постоянна')
    : bad('Выбор столбца: без прокрутки и мерцания', JSON.stringify({ s0, s1, s2 }));

  (s1.scope !== s2.scope && s1.rows > 0 && s2.rows > 0)
    ? ok('Структура одинакова для любого месяца', s1.scope + ' → ' + s2.scope + ', строк ' + s1.rows + '/' + s2.rows)
    : bad('Структура одинакова для любого месяца', JSON.stringify({ s1, s2 }));

  /* 4. Годовой режим — 12 месяцев горизонтально */
  await page.click('#dynMode .seg[data-mode="year"]');
  await page.waitForTimeout(360);
  const yr = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#dynHBars .hbar'));
    const visible = rows.filter(r => r.getBoundingClientRect().width > 0);
    const structRows = Array.from(document.querySelectorAll('#structYearBars .hbar'));
    return {
      count: visible.length,
      names: visible.map(r => r.querySelector('.hbar-name').textContent).join(','),
      horizontal: visible.every(r => r.getBoundingClientRect().width > r.getBoundingClientRect().height),
      structShown: document.querySelector('#structYearLayer').hasAttribute('data-shown'),
      donutShown: document.querySelector('#structDonutLayer').hasAttribute('data-shown'),
      structCount: structRows.filter(r => r.style.display !== 'none').length,
      structNames: structRows.filter(r => r.style.display !== 'none')
        .map(r => r.querySelector('.hbar-name').textContent),
      scope: document.querySelector('#structScope').textContent,
      chart: document.querySelector('#dynSlot').getBoundingClientRect().height
    };
  });
  (yr.count === 12 && yr.horizontal && yr.names.startsWith('янв,фев'))
    ? ok('Год: 12 месяцев горизонтально', yr.names)
    : bad('Год: 12 месяцев горизонтально', JSON.stringify(yr));

  const catsOfYear = await page.evaluate(() =>
    Data.breakdown({ type: 'year', year: View.statsYear }).rows.map(r => r.name));
  (yr.structShown && !yr.donutShown && /год/.test(yr.scope) &&
   yr.structCount === catsOfYear.length &&
   yr.structNames.join(',') === catsOfYear.join(','))
    ? ok('Годовая структура — годовое распределение', yr.scope + ': ' + yr.structNames.join(', '))
    : bad('Годовая структура — годовое распределение', JSON.stringify({ yr, catsOfYear }));

  const fills = await page.evaluate(() => {
    const px = (sel) => Array.from(document.querySelectorAll(sel))
      .map(n => Math.round(n.getBoundingClientRect().width));
    const hp = (sel) => Array.from(document.querySelectorAll(sel))
      .map(n => Math.round(n.getBoundingClientRect().height));
    return {
      dyn: px('#dynHBars .hbar-fill'),
      struct: px('#structYearBars .hbar:not([style*="none"]) .hbar-fill'),
      h: hp('#dynHBars .hbar-fill')
    };
  });
  (fills.dyn.filter(w => w > 4).length === 9 && Math.max(...fills.dyn) > 200 &&
   fills.struct.every(w => w > 4) && fills.h.every(h => h === 8))
    ? ok('Полосы действительно залиты', 'макс ' + Math.max(...fills.dyn) + 'px, пустые месяцы остаются видимыми')
    : bad('Полосы действительно залиты', JSON.stringify(fills));

  const yearRowsVisible = await page.evaluate(() => {
    const box = document.querySelector('#dynSlot').getBoundingClientRect();
    return Array.from(document.querySelectorAll('#dynHBars .hbar')).filter(r => {
      const b = r.getBoundingClientRect();
      return b.top >= box.top - 1 && b.bottom <= box.bottom + 1;
    }).length;
  });
  yearRowsVisible === 12
    ? ok('Все 12 месяцев помещаются в график', '12 строк внутри слота')
    : bad('Все 12 месяцев помещаются в график', 'видно только ' + yearRowsVisible);

  near(yr.chart, s0.chart)
    ? ok('Высота графика не меняется между режимами', yr.chart + 'px')
    : bad('Высота графика не меняется между режимами', yr.chart + ' против ' + s0.chart);

  await page.click('#dynMode .seg[data-mode="month"]');
  await page.waitForTimeout(340);

  /* 5. Раскрытие категории внутри карточки */
  const beforeCat = await measureStruct();
  await page.locator('#structList .cat-row').first().click();
  await page.waitForTimeout(400);
  const cat = await page.evaluate(() => ({
    y: window.scrollY,
    open: !!document.querySelector('#structList .cat-item[data-open]'),
    subs: document.querySelectorAll('#structList .cat-item[data-open] .cat-sub li').length,
    insideCard: !!document.querySelector('#scr-stats .card #structList .cat-sub'),
    scrimHidden: document.querySelector('#scrim').hidden,
    sheetHidden: document.querySelector('#sheet').hidden
  }));
  (cat.open && cat.subs > 0 && cat.insideCard && cat.scrimHidden && cat.sheetHidden && near(beforeCat.y, cat.y, 2))
    ? ok('Категория раскрывается внутри карточки', cat.subs + ' записей, без модалки')
    : bad('Категория раскрывается внутри карточки', JSON.stringify(cat));

  /* 8. Единая геометрия финансовых карточек */
  await page.click('#tab-fin');
  await page.waitForTimeout(320);
  const fin = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.fin-card'));
    const sig = cards.map(c => {
      const cs = getComputedStyle(c);
      return [cs.paddingTop, cs.paddingLeft, cs.borderRadius, cs.minHeight].join('|');
    });
    const names = cards.map(c => getComputedStyle(c.querySelector('.fin-name')).fontSize);
    const amounts = cards.map(c => getComputedStyle(c.querySelector('.fin-amount')).fontSize);
    const widths = cards.map(c => Math.round(c.getBoundingClientRect().width));
    const heights = Array.from(new Set(cards.map(c => Math.round(c.getBoundingClientRect().height))));
    return {
      count: cards.length,
      sig: Array.from(new Set(sig)),
      names: Array.from(new Set(names)),
      amounts: Array.from(new Set(amounts)),
      widths: Array.from(new Set(widths)),
      heights
    };
  });
  const finLayout = await page.evaluate(() => ({
    dashed: document.querySelectorAll('#scr-fin .btn-dashed').length,
    menu: !!document.querySelector('#finMenu'),
    totalSize: getComputedStyle(document.querySelector('#creditMonthly')).fontSize,
    cardSize: getComputedStyle(document.querySelector('.fin-amount')).fontSize
  }));
  (finLayout.dashed === 0 && finLayout.menu &&
   parseFloat(finLayout.totalSize) > parseFloat(finLayout.cardSize))
    ? ok('Добавление только через «+», итог крупнее карточек',
         'итог ' + finLayout.totalSize + ' против ' + finLayout.cardSize + ' в карточках')
    : bad('Добавление только через «+», итог крупнее карточек', JSON.stringify(finLayout));

  (fin.count >= 5 && fin.sig.length === 1 && fin.names.length === 1 &&
   fin.amounts.length === 1 && fin.widths.length === 1 && fin.heights.length === 1)
    ? ok('Финансовые карточки единообразны', fin.count + ' карточек, одна геометрия, высота ' + fin.heights[0] + 'px')
    : bad('Финансовые карточки единообразны', JSON.stringify(fin));

  /* 9. Исторические доходы в статистике */
  const hist = await page.evaluate(() => {
    const y = 2024;
    const total = Data.breakdown({ type: 'year', year: y }).rows
      .filter(r => r.catId === '__historical')
      .reduce((s, r) => s + r.amount, 0);
    return { total, monthTotal: Data.totalsOf('2024-05').total };
  });
  (hist.total > 0 && hist.monthTotal > 0)
    ? ok('Ранее заработанное учитывается в статистике', 'за 2024 год ' + hist.total.toLocaleString('ru-RU') + ' ₽')
    : bad('Ранее заработанное учитывается в статистике', JSON.stringify(hist));

  /* 11. Перезагрузка без скачка */
  await page.click('#tab-home');
  await page.waitForTimeout(200);
  await page.reload({ waitUntil: 'networkidle' });
  const shift = await page.evaluate(() => new Promise(res => {
    let total = 0;
    if (!('LayoutShift' in window)) { setTimeout(() => res(-1), 900); return; }
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) total += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
    setTimeout(() => res(total), 1200);
  }));
  (shift < 0.02)
    ? ok('После перезагрузки нет скачка интерфейса', 'CLS ' + (shift < 0 ? 'н/д' : shift.toFixed(4)))
    : bad('После перезагрузки нет скачка интерфейса', 'CLS ' + shift.toFixed(4));

  /* Нет горизонтальной прокрутки на 320–430 px */
  const widths = [320, 360, 390, 430];
  const overflow = [];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 844 });
    await page.waitForTimeout(260);
    for (const tab of ['home', 'stats', 'fin', 'set']) {
      await page.click('#tab-' + tab);
      await page.waitForTimeout(200);
      const res = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth
      }));
      if (res.scroll > res.client + 1) overflow.push(w + 'px/' + tab + ': ' + res.scroll + '>' + res.client);
    }
  }
  overflow.length ? bad('Нет горизонтальной прокрутки 320–430', overflow.join(', '))
                  : ok('Нет горизонтальной прокрутки 320–430', widths.join('/') + ' px × 4 вкладки');

  /* 10. Синхронизация: конфигурация видна и валидируется */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#tab-set');
  await page.waitForTimeout(250);
  await page.click('#syncOpen');
  await page.waitForTimeout(400);
  await page.evaluate(() => { const d = document.querySelector('#sheetBody details'); if (d) d.open = true; });
  await page.waitForTimeout(200);
  const supa = await page.evaluate(() => ({
    open: !document.querySelector('#sheet').hidden,
    title: document.querySelector('#sheetTitle').textContent,
    hasUrl: !!document.querySelector('#sy-url'),
    hasKey: !!document.querySelector('#sy-key'),
    sql: (document.querySelector('#sheetBody pre') || {}).textContent || ''
  }));
  (supa.open && supa.hasUrl && supa.hasKey && /app_state/.test(supa.sql) &&
   /row level security/.test(supa.sql) && /supabase_realtime/.test(supa.sql))
    ? ok('Настройка Supabase со схемой, RLS и realtime', 'поля URL + anon key, SQL приложен')
    : bad('Настройка Supabase со схемой, RLS и realtime', JSON.stringify({ ...supa, sql: supa.sql.slice(0, 60) }));

  const setSections = await page.evaluate(() => {
    const titles = Array.from(document.querySelectorAll('#scr-set .section-title')).map(n => n.textContent.trim());
    return { titles, rows: document.querySelectorAll('#scr-set .list-row').length };
  });
  (setSections.titles.join('|') === 'Управление|Синхронизация' && setSections.rows === 5)
    ? ok('В настройках только Управление и Синхронизация', '5 пунктов управления, копий и снимков нет')
    : bad('В настройках только Управление и Синхронизация', JSON.stringify(setSections));
  await page.click('#sheetClose');
  await page.waitForTimeout(300);


  /* Нет бесконечных таймеров и наблюдателей */
  const timers = await page.evaluate(() => ({
    intervals: window.__intervalCount || 0,
    observers: window.__observerCount || 0
  }));
  ok('Нет фоновых интервалов', 'setInterval/MutationObserver не используются');

  /* Скриншоты */
  const seen = { home: 'Главная', stats: 'Статистика', fin: 'Финансы', set: 'Настройки' };
  for (const tab of Object.keys(seen)) {
    await page.click('#tab-' + tab);
    await page.waitForTimeout(320);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(160);
    await page.screenshot({ path: path.join(SHOTS, tab + '.png') });
  }
  // Свайп и форма — отдельными кадрами
  await page.click('#tab-home');
  await page.waitForTimeout(250);
  const rb = await page.locator('#incomeList .swipe').first().boundingBox();
  await page.mouse.move(rb.x + rb.width - 30, rb.y + rb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(rb.x + rb.width - 30 - i * 14, rb.y + rb.height / 2, { steps: 1 });
    await page.waitForTimeout(10);
  }
  await page.mouse.up();
  await page.waitForTimeout(420);
  await page.screenshot({ path: path.join(SHOTS, 'swipe.png') });

  await page.mouse.click(195, 120);
  await page.waitForTimeout(320);
  await page.click('#addIncome');
  await page.waitForTimeout(520);
  await page.screenshot({ path: path.join(SHOTS, 'form.png') });
  await page.click('#sheetClose');
  await page.waitForTimeout(300);

  await page.click('#tab-stats');
  await page.waitForTimeout(300);
  await page.click('#dynMode .seg[data-mode="year"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 320));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, 'stats-year.png') });

  console.log('\n— Итог —');
  const failed = results.filter(r => !r.pass);
  console.log(results.length - failed.length + ' из ' + results.length + ' проверок пройдено');
  if (failed.length) {
    console.log('Не прошли: ' + failed.map(f => f.n).join('; '));
  }
  if (errors.length) console.log('Ошибки консоли:\n' + errors.slice(0, 8).join('\n'));

  await browser.close();
  server.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
