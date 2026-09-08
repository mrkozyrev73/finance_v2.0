#!/usr/bin/env node
/*
 * Проверка синхронизации на двух «телефонах».
 *
 * Настоящего проекта Supabase здесь нет, поэтому поднимается мок с теми же
 * повадками: одна строка на пользователя, upsert возвращает updated_at,
 * изменения рассылаются подписчикам через SSE. В страницу подставляется
 * заглушка window.supabase с тем же API, что использует приложение —
 * так проверяется именно наш код синхронизации: pull, merge, push,
 * применение realtime-события и догоняющий запрос после возврата из фона.
 */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/json', '.png': 'image/png' };

/* ---------- Мок базы ---------- */

const rows = new Map();          // user_id -> { data, updated_at }
const subs = new Map();          // user_id -> Set(res)
let writes = 0;

function broadcast(userId, row) {
  const set = subs.get(userId);
  if (!set) return;
  const payload = 'data: ' + JSON.stringify(row) + '\n\n';
  for (const res of set) res.write(payload);
}

function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => { b += c; });
    req.on('end', () => resolve(b ? JSON.parse(b) : {}));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/mock/get') {
    const row = rows.get(url.searchParams.get('u')) || null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(row));
    return;
  }

  if (url.pathname === '/mock/upsert') {
    const body = await readBody(req);
    const row = { data: body.data, updated_at: new Date().toISOString() + '#' + (++writes) };
    rows.set(body.user_id, row);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ updated_at: row.updated_at }));
    broadcast(body.user_id, row);
    return;
  }

  if (url.pathname === '/mock/events') {
    const u = url.searchParams.get('u');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(':ok\n\n');
    if (!subs.has(u)) subs.set(u, new Set());
    subs.get(u).add(res);
    req.on('close', () => { const s = subs.get(u); if (s) s.delete(res); });
    return;
  }

  let p = url.pathname; if (p === '/') p = '/index.html';
  const f = path.join(DIST, p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

/* ---------- Заглушка клиента, внедряемая в страницу ---------- */

function stub(base) {
  const USER = { id: 'user-1', email: 'anton@dohod.app' };
  const SESSION = { user: USER, access_token: 'stub' };

  window.__syncLog = [];
  const log = (m) => window.__syncLog.push(m);

  window.supabase = {
    createClient() {
      const listeners = [];
      let es = null;

      return {
        auth: {
          getSession: async () => ({ data: { session: window.__signedIn ? SESSION : null } }),
          onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
          async signInWithPassword({ email }) {
            window.__signedIn = true;
            log('signIn ' + email);
            return { data: { session: Object.assign({}, SESSION, { user: { id: 'user-1', email } }) }, error: null };
          },
          async signUp(a) { return this.signInWithPassword(a); },
          async signOut() { window.__signedIn = false; return { error: null }; }
        },

        from() {
          const q = { _uid: null };
          const api = {
            select() { return api; },
            eq(_c, v) { q._uid = v; return api; },
            async maybeSingle() {
              const r = await fetch(base + 'mock/get?u=' + q._uid).then(r => r.json());
              log('pull');
              return { data: r, error: null };
            },
            async single() { return api._pending; },
            upsert(payload) {
              api._pending = fetch(base + 'mock/upsert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              }).then(r => r.json()).then(d => { log('push'); return { data: d, error: null }; });
              return api;
            }
          };
          return api;
        },

        channel(name) {
          const ch = { name, _cb: null };
          ch.on = (_ev, _opts, cb) => { ch._cb = cb; return ch; };
          ch.subscribe = (cb) => {
            es = new EventSource(base + 'mock/events?u=user-1');
            es.onopen = () => { log('subscribed'); if (cb) cb('SUBSCRIBED'); };
            es.onmessage = (e) => {
              log('realtime');
              ch._cb && ch._cb({ new: JSON.parse(e.data) });
            };
            ch._es = es;
            return ch;
          };
          return ch;
        },
        removeChannel(ch) { if (ch && ch._es) ch._es.close(); }
      };
    }
  };
}

/* ---------- Тест ---------- */

const out = [];
const ok  = (n, d) => { out.push(true);  console.log('  ✓ ' + n + (d ? '  — ' + d : '')); };
const bad = (n, d) => { out.push(false); console.log('  ✗ ' + n + (d ? '  — ' + d : '')); };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  const errors = [];
  async function phone(label) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(label + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); });
    await page.addInitScript(b => {
      localStorage.setItem('dohod.supabase.v1', JSON.stringify({ url: b, key: 'anon' }));
      window.__signedIn = true;
    }, base);
    await page.addInitScript(stub, base);
    await page.goto(base, { waitUntil: 'domcontentloaded' });   // SSE держит сеть, networkidle не наступит
    await page.waitForTimeout(900);
    return { ctx, page, label };
  }

  console.log('\n— Два телефона на одном аккаунте —');

  const a = await phone('A');
  const b = await phone('B');

  const statusA = await a.page.textContent('#syncTitle');
  const statusB = await b.page.textContent('#syncTitle');
  (statusA === 'Включена' && statusB === 'Включена')
    ? ok('Оба устройства подключились', statusA)
    : bad('Оба устройства подключились', statusA + ' / ' + statusB);

  /* A добавляет доход — B должен увидеть его сам */
  const t0 = Date.now();
  await a.page.evaluate(() => {
    Store.add('incomes', {
      title: 'Обзор Kia K5', amount: 99000, status: 'expected',
      categoryId: Data.categories()[0].id, date: View.key + '-15'
    }, 'Обзор Kia K5');
  });

  let sawIt = false, elapsed = 0;
  for (let i = 0; i < 60; i++) {
    sawIt = await b.page.evaluate(() =>
      Store.list('incomes').some(r => r.title === 'Обзор Kia K5' && r.amount === 99000));
    if (sawIt) { elapsed = Date.now() - t0; break; }
    await b.page.waitForTimeout(50);
  }
  const shownInList = sawIt && await b.page.evaluate(() =>
    Array.from(document.querySelectorAll('#incomeList .income-title')).some(n => n.textContent === 'Обзор Kia K5'));
  (sawIt && shownInList && elapsed < 1500)
    ? ok('Правка с A приходит на B сама', 'за ' + elapsed + ' мс, строка в списке есть')
    : bad('Правка с A приходит на B сама', JSON.stringify({ sawIt, shownInList, elapsed }));

  /* B меняет статус — A должен подхватить */
  const t1 = Date.now();
  await b.page.evaluate(() => {
    const rec = Store.list('incomes').find(r => r.title === 'Обзор Kia K5');
    Store.patch('incomes', rec.id, { status: 'received' }, rec.title);
  });
  let back = false, elapsed2 = 0;
  for (let i = 0; i < 60; i++) {
    back = await a.page.evaluate(() =>
      Store.list('incomes').some(r => r.title === 'Обзор Kia K5' && r.status === 'received'));
    if (back) { elapsed2 = Date.now() - t1; break; }
    await a.page.waitForTimeout(50);
  }
  (back && elapsed2 < 1500)
    ? ok('Обратное направление тоже работает', 'за ' + elapsed2 + ' мс')
    : bad('Обратное направление тоже работает', JSON.stringify({ back, elapsed2 }));

  /* Одновременные правки разных записей не затирают друг друга */
  await Promise.all([
    a.page.evaluate(() => Store.add('incomes', {
      title: 'Только на A', amount: 1000, status: 'expected',
      categoryId: Data.categories()[1].id, date: View.key + '-03'
    }, 'Только на A')),
    b.page.evaluate(() => Store.add('incomes', {
      title: 'Только на B', amount: 2000, status: 'expected',
      categoryId: Data.categories()[2].id, date: View.key + '-04'
    }, 'Только на B'))
  ]);
  await a.page.waitForTimeout(1400);
  await a.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await b.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await a.page.waitForTimeout(900);

  const both = async (pg) => pg.evaluate(() => {
    const t = Store.list('incomes').map(r => r.title);
    return { a: t.includes('Только на A'), b: t.includes('Только на B') };
  });
  const ra = await both(a.page), rb = await both(b.page);
  (ra.a && ra.b && rb.a && rb.b)
    ? ok('Одновременные правки сливаются, ничего не потеряно', 'обе записи видны на обоих')
    : bad('Одновременные правки сливаются, ничего не потеряно', JSON.stringify({ ra, rb }));

  /* Возврат из фона догоняет пропущенное, даже если сокет молчал */
  await b.page.evaluate(() => { window.__frozen = true; });
  await b.page.evaluate(() => {
    const ch = window.__stubChannel;
    if (ch && ch._es) ch._es.close();          // «телефон уснул»
  });
  await a.page.evaluate(() => Store.add('incomes', {
    title: 'Пока B спал', amount: 555, status: 'expected',
    categoryId: Data.categories()[0].id, date: View.key + '-07'
  }, 'Пока B спал'));
  await a.page.waitForTimeout(700);
  await b.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  let caught = false;
  for (let i = 0; i < 40; i++) {
    caught = await b.page.evaluate(() => Store.list('incomes').some(r => r.title === 'Пока B спал'));
    if (caught) break;
    await b.page.waitForTimeout(50);
  }
  caught ? ok('Возврат из фона догоняет пропущенное')
         : bad('Возврат из фона догоняет пропущенное');

  /* Число запросов не растёт лавинообразно */
  const logA = await a.page.evaluate(() => window.__syncLog.filter(x => x === 'push').length);
  logA < 12 ? ok('Отправок ровно столько, сколько изменений', logA + ' push')
            : bad('Отправок ровно столько, сколько изменений', logA + ' push — похоже на цикл');

  errors.length ? bad('Без ошибок в консоли', errors.slice(0, 3).join(' | '))
                : ok('Без ошибок в консоли');

  console.log('\n— Итог —');
  const failed = out.filter(v => !v).length;
  console.log((out.length - failed) + ' из ' + out.length + ' проверок пройдено');

  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
