#!/usr/bin/env node
/* Дымовой тест: открыть каждый лист, нажать всё безопасное, поймать ошибки */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildSeed } = require('./seed');

const DIST = path.join(__dirname, 'dist');
const SHOTS = path.join(__dirname, 'shots');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/json', '.png': 'image/png' };

const errors = [];
const steps = [];

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
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.addInitScript(s => localStorage.setItem('dohod.state.v1', JSON.stringify(s)), buildSeed());
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  const sheetOpen = () => page.evaluate(() => !document.querySelector('#sheet').hidden);
  const close = async () => {
    if (await sheetOpen()) { await page.click('#sheetClose'); await page.waitForTimeout(320); }
  };
  const step = async (name, fn, shot) => {
    const before = errors.length;
    try {
      await fn();
      await page.waitForTimeout(360);
      const opened = await sheetOpen();
      const title = opened ? await page.textContent('#sheetTitle') : '—';
      if (shot) await page.screenshot({ path: path.join(SHOTS, shot + '.png') });
      steps.push({ name, opened, title, newErrors: errors.length - before });
      console.log((errors.length === before ? '  ✓ ' : '  ✗ ') + name +
        (opened ? '  → «' + title + '»' : '  (лист не открылся)'));
    } catch (e) {
      steps.push({ name, error: e.message });
      console.log('  ✗ ' + name + '  — ' + e.message.split('\n')[0]);
    }
    await close();
  };

  console.log('\n— Листы настроек —');
  await page.click('#tab-set'); await page.waitForTimeout(300);
  for (const [key, label, shot] of [
    ['categories', 'Категории и владельцы', 'sheet-categories'],
    ['recurring', 'Регулярные доходы', null],
    ['history', 'История действий', null],
    ['trash', 'Корзина', null],
    ['historical', 'Ранее заработанные доходы', 'sheet-historical'],
  ]) {
    await step(label, async () => {
      await page.click('#tab-set');
      await page.waitForTimeout(150);
      await page.click('[data-open="' + key + '"]');
    }, shot);
  }
  await step('Синхронизация', async () => {
    await page.click('#tab-set');
    await page.waitForTimeout(150);
    await page.click('#syncOpen');
  }, 'sheet-sync');

  console.log('\n— Финансы —');
  await page.click('#tab-fin'); await page.waitForTimeout(300);
  await step('Редактирование сейфа', () => page.click('#safeEdit'));
  await step('Меню добавления', () => page.click('#finMenu'), 'sheet-add');
  await step('Карточка вклада', async () => {
    await page.click('#tab-fin'); await page.waitForTimeout(150);
    await page.locator('#depList .fin-card').first().click();
  }, 'sheet-deposit');
  await step('Карточка кредита', async () => {
    await page.click('#tab-fin'); await page.waitForTimeout(150);
    await page.locator('#creditList .fin-card').first().click();
  }, 'sheet-credit');

  console.log('\n— Форма дохода: сохранение и удаление —');
  await page.click('#tab-home'); await page.waitForTimeout(300);
  const countBefore = await page.locator('#incomeList .swipe').count();
  await page.click('#addIncome'); await page.waitForTimeout(420);
  await page.fill('#f-amount', '12345');
  await page.fill('#f-title', 'Тестовый доход');
  await page.click('#sheetFoot .btn'); await page.waitForTimeout(500);
  const countAfter = await page.locator('#incomeList .swipe').count();
  const added = await page.evaluate(() =>
    Store.list('incomes').some(r => r.title === 'Тестовый доход' && r.amount === 12345));
  console.log((added && countAfter === countBefore + 1 ? '  ✓ ' : '  ✗ ') +
    'Доход сохраняется: строк ' + countBefore + ' → ' + countAfter + ', в хранилище ' + added);

  await page.evaluate(() => {
    const rec = Store.list('incomes').find(r => r.title === 'Тестовый доход');
    Store.remove('incomes', rec.id, rec.title);
  });
  await page.waitForTimeout(400);
  const countBack = await page.locator('#incomeList .swipe').count();
  const inTrash = await page.evaluate(() => Store.trash().length);
  console.log((countBack === countBefore && inTrash > 0 ? '  ✓ ' : '  ✗ ') +
    'Удаление уводит в корзину: строк ' + countBack + ', в корзине ' + inTrash);

  console.log('\n— Галочка «получен» в строке —');
  await page.click('#tab-home'); await page.waitForTimeout(300);
  const dotBefore = await page.evaluate(() => {
    const row = document.querySelector('#incomeList .swipe');
    const dot = row.querySelector('.status-dot');
    return {
      tag: dot.tagName, pressed: dot.getAttribute('aria-pressed'),
      cls: dot.className, box: Math.round(dot.getBoundingClientRect().height),
      rowH: Math.round(row.getBoundingClientRect().height),
      flag: row.querySelector('.income-flag').textContent
    };
  });
  await page.locator('#incomeList .status-dot').first().click();
  await page.waitForTimeout(420);
  const dotAfter = await page.evaluate(() => {
    const row = document.querySelector('#incomeList .swipe');
    const dot = row.querySelector('.status-dot');
    return {
      pressed: dot.getAttribute('aria-pressed'), cls: dot.className,
      rowH: Math.round(row.getBoundingClientRect().height),
      flag: row.querySelector('.income-flag').textContent,
      sheetHidden: document.querySelector('#sheet').hidden,
      received: Store.list('incomes').filter(r => r.status === 'received').length
    };
  });
  const toggleOk = dotBefore.tag === 'BUTTON' && dotBefore.pressed === 'false' &&
    dotAfter.pressed === 'true' && dotAfter.flag === 'Получен' &&
    dotAfter.sheetHidden && dotBefore.rowH === dotAfter.rowH;
  console.log((toggleOk ? '  ✓ ' : '  ✗ ') +
    'Тап по галочке меняет статус, форма не открывается: ' +
    dotBefore.flag + ' → ' + dotAfter.flag + ', высота строки ' + dotAfter.rowH + 'px');
  if (!toggleOk) console.log('    ' + JSON.stringify({ dotBefore, dotAfter }));
  await page.screenshot({ path: path.join(SHOTS, 'check-toggle.png') });
  // возвращаем обратно
  await page.locator('#incomeList .status-dot').first().click();
  await page.waitForTimeout(360);

  console.log('\n— Категории —');
  await page.click('#tab-set'); await page.waitForTimeout(250);
  await page.click('[data-open="categories"]'); await page.waitForTimeout(420);
  const cats = await page.evaluate(() => ({
    names: Data.categories().map(c => c.name),
    colors: new Set(Data.categories().map(c => c.color)).size,
    hasOwners: /Владел/.test(document.querySelector('#sheetBody').textContent)
  }));
  const expected = ['Обзор', 'Статья на Дзен', 'Интеграция PRO АВТО', 'Продажа Авито',
    'Продажа напрямую', 'Контракт', 'Монетизация YouTube', 'Монетизация RuTube',
    'Монетизация VK', 'Участие в рейтинге', 'Съёмка под заказ', 'Кешбек сервисы', 'Прочее'];
  const catsOk = cats.names.join('|') === expected.join('|') && cats.colors === 13 && !cats.hasOwners;
  console.log((catsOk ? '  ✓ ' : '  ✗ ') + '13 категорий, 13 разных цветов, владельцев нет');
  if (!catsOk) console.log('    ' + JSON.stringify(cats));
  await page.screenshot({ path: path.join(SHOTS, 'sheet-categories.png') });
  await close();

  const noOwner = await page.evaluate(() => {
    const t = document.body.textContent;
    return !/Владел/.test(t);
  });
  await page.click('#tab-home'); await page.waitForTimeout(200);
  await page.click('#addIncome'); await page.waitForTimeout(420);
  const formOwner = await page.evaluate(() => ({
    hasOwnerField: !!document.querySelector('#f-owner'),
    text: /Владел/.test(document.querySelector('#sheetBody').textContent),
    quick: Array.from(document.querySelectorAll('.quick-cat')).map(n => n.textContent)
  }));
  console.log(((!formOwner.hasOwnerField && !formOwner.text && noOwner) ? '  ✓ ' : '  ✗ ') +
    'Поля «Владелец» нет ни в форме, ни на экранах');
  console.log('    быстрые категории: ' + formOwner.quick.join(', '));
  await page.screenshot({ path: path.join(SHOTS, 'form.png') });
  await close();

  console.log('\n— Ранее заработанное —');
  await page.click('#tab-set'); await page.waitForTimeout(250);
  await page.click('[data-open="historical"]'); await page.waitForTimeout(420);
  await page.selectOption('#h-year', '2025');
  await page.selectOption('#h-month', '4');
  await page.fill('#h-amt', '137000');
  await page.click('#sheetBody .btn'); await page.waitForTimeout(420);
  const histToast = await page.evaluate(() => {
    const list = document.querySelectorAll('#toasts .toast .t');
    return list.length ? list[list.length - 1].textContent : '';   // самый свежий
  });
  const histSaved = await page.evaluate(() =>
    Store.list('historical').some(h => h.year === 2025 && h.month === 4 && h.amount === 137000));
  const histRow = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#sheetBody .list-row'))
      .some(n => /Май 2025/.test(n.textContent) && /137/.test(n.textContent)));
  // Intl ru-RU разделяет разряды неразрывным пробелом — сравниваем по цифрам
  const toastDigits = histToast.replace(/\D/g, '');
  const histOk = histSaved && histRow && toastDigits === '2025137000';
  console.log((histOk ? '  ✓ ' : '  ✗ ') + 'Сумма сохраняется и попадает в тост: «' + histToast + '»');
  console.log((histRow ? '  ✓ ' : '  ✗ ') + 'Значение появляется в списке «Уже добавлено»');
  const inStats = await page.evaluate(() => Data.totalsOf('2025-05').total);
  console.log((inStats >= 137000 ? '  ✓ ' : '  ✗ ') + 'Учитывается в статистике мая 2025: ' + inStats);
  await close();

  console.log('\n— Регулярный доход —');
  await page.click('#tab-home'); await page.waitForTimeout(300);
  await page.click('#addIncome'); await page.waitForTimeout(420);
  await page.fill('#f-amount', '5000');
  await page.fill('#f-title', 'Подписка');
  await page.click('#sheetBody .switch');
  await page.click('#sheetFoot .btn'); await page.waitForTimeout(450);
  await page.click('#monthNext'); await page.waitForTimeout(450);
  const repeated = await page.evaluate(() =>
    Data.incomesOf(View.key).some(r => r.title === 'Подписка' && r.recurringId));
  console.log((repeated ? '  ✓ ' : '  ✗ ') + 'Повтор появляется в следующем месяце');
  await page.click('#monthPrev'); await page.waitForTimeout(350);

  console.log('\n— Уменьшенное движение —');
  await ctx.close();
  const ctx2 = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU',
    reducedMotion: 'reduce', hasTouch: true, isMobile: true
  });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push('reduced-motion: ' + e.message));
  await p2.addInitScript(s => localStorage.setItem('dohod.state.v1', JSON.stringify(s)), buildSeed());
  await p2.goto(base, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(400);
  await p2.click('#tab-stats'); await p2.waitForTimeout(250);
  await p2.click('#addIncome').catch(() => {});
  await p2.click('#tab-home'); await p2.waitForTimeout(250);
  await p2.click('#addIncome'); await p2.waitForTimeout(300);
  const rmOk = await p2.evaluate(() => !document.querySelector('#sheet').hidden);
  console.log((rmOk ? '  ✓ ' : '  ✗ ') + 'Листы открываются при prefers-reduced-motion');

  console.log('\n— Итог —');
  console.log(errors.length ? 'Ошибок: ' + errors.length + '\n' + errors.slice(0, 10).join('\n')
                            : 'Ошибок в консоли нет');
  await browser.close();
  server.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
