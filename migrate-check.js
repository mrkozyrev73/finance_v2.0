/* Проверка обновления с первой версии: старые категории должны замениться */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const DIST = path.join(__dirname, 'dist');
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.webmanifest':'application/json','.png':'image/png'};

const legacy = (withIncome) => {
  const t = Date.now();
  let n = 0; const uid = () => 'OLD' + (++n);
  const st = o => Object.assign({ id: uid(), createdAt: t, updatedAt: t, deletedAt: null }, o);
  const cats = ['Зарплата','Фриланс','Аренда','Дивиденды','Продажи','Прочее']
    .map((name, i) => st({ name, color: '#18A46B', order: i }));
  const owners = [st({ name: 'Я' })];
  const incomes = withIncome ? [st({
    title: 'Старый доход', amount: 50000, status: 'received',
    categoryId: cats[0].id, ownerId: owners[0].id, date: new Date().toISOString().slice(0,10)
  })] : [];
  return { schema: 1, incomes, categories: cats, owners, recurring: [], historical: [],
    deposits: [], credits: [], earlyPayments: [], notes: [], history: [],
    safe: { name: 'Наличные дома', amount: 0, updatedAt: t },
    settings: { dynMode: 'month', lastTab: 'home', updatedAt: t } };
};

(async () => {
  const server = http.createServer((req,res)=>{let p=req.url.split('?')[0]; if(p==='/')p='/index.html';
    const f=path.join(DIST,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
    fs.createReadStream(f).pipe(res);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base = 'http://127.0.0.1:'+server.address().port+'/';
  const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});

  const run = async (state, label) => {
    const ctx = await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU'});
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript(s => localStorage.setItem('dohod.state.v1', JSON.stringify(s)), state);
    await page.goto(base, {waitUntil:'networkidle'});
    await page.waitForTimeout(500);
    const out = await page.evaluate(() => ({
      cats: Data.categories().map(c => c.name),
      incomes: Store.list('incomes').map(r => ({ t: r.title, cat: Data.categoryName(r.categoryId) })),
      hasOwnerUI: /Владел/.test(document.body.textContent)
    }));
    await ctx.close();
    return { label, out, errs };
  };

  /* Свои категории пользователь мог настроить сам — их трогать нельзя */
  const custom = () => {
    const st = legacy(true);
    st.categories[0].name = 'Моя категория';
    st.categories[1].name = 'Ещё моя';
    st.categories.length = 2;
    st.incomes[0].categoryId = st.categories[0].id;
    return st;
  };

  const a = await run(legacy(false), 'чистая установка первой версии');
  const b = await run(legacy(true), 'первая версия с внесённым доходом');
  const c = await run(custom(), 'пользователь настроил свои категории');

  const okA = a.out.cats[0] === 'Обзор' && a.out.cats.length === 13 && !a.errs.length;
  console.log((okA ? '✓ ' : '✗ ') + a.label + ' → ' + a.out.cats.slice(0,3).join(', ') + '… (' + a.out.cats.length + ')');

  const okB = b.out.cats[0] === 'Обзор' && b.out.cats.length === 13 &&
              b.out.incomes.length === 1 && b.out.incomes[0].cat === 'Прочее' && !b.errs.length;
  console.log((okB ? '✓ ' : '✗ ') + b.label + ' → набор заменён, доход не потерян');
  console.log('   доход: ' + JSON.stringify(b.out.incomes));

  const okC = c.out.cats.join('|') === 'Моя категория|Ещё моя' &&
              c.out.incomes[0].cat === 'Моя категория' && !c.errs.length;
  console.log((okC ? '✓ ' : '✗ ') + c.label + ' → не тронуты: ' + c.out.cats.join(', '));

  const okD = !a.out.hasOwnerUI && !b.out.hasOwnerUI && !c.out.hasOwnerUI;
  console.log((okD ? '✓ ' : '✗ ') + 'Владелец нигде не показывается даже в старых данных');

  /* Повторный запуск ничего не ломает и не плодит копии */
  const twice = await run(JSON.parse(JSON.stringify(
    { ...legacy(true) })), 'повторное открытие');
  const okE = twice.out.cats.length === 13;
  console.log((okE ? '✓ ' : '✗ ') + 'Набор не дублируется при повторных запусках — ' + twice.out.cats.length + ' категорий');

  const errs = a.errs.concat(b.errs, c.errs, twice.errs);
  if (errs.length) console.log('Ошибки:', errs.join(' | '));
  await browser.close(); server.close();
  process.exit(okA && okB && okC && okD && okE ? 0 : 1);
})();
