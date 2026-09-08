/* ============================================================
   Статистика: аудит, динамика, структура
   Геометрия фиксирована: обе диаграммы живут в слотах заданной
   высоты, переключение — opacity/visibility, а не удаление узлов.
   ============================================================ */

const Stats = (() => {
  const MONTH_COLS = 6;
  const DONUT_SLICES = 8;    // больше секторов кольцо не читает
  const YEAR_BARS = 12;      // месяцы выбранного года в структуре
  const barNodes = [];     // столбцы месячного режима
  const hbarNodes = [];    // строки годового режима
  const structYearNodes = [];
  const catNodes = new Map();
  let donutBuilt = false;
  let moveThumb = () => {};

  /* ---------- Монтирование: узлы создаются один раз ---------- */

  function mount() {
    const seg = $('#dynMode');
    const thumb = $('.segmented-thumb', seg);
    const segs = $$('.seg', seg);

    moveThumb = () => {
      const active = segs.find(b => b.getAttribute('aria-selected') === 'true') || segs[0];
      if (!active.offsetWidth) return;          // экран скрыт — измерим при показе
      const parentRect = seg.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      thumb.style.width = activeRect.width + 'px';
      thumb.style.transform = 'translateX(' + (activeRect.left - parentRect.left) + 'px)';
    };

    segs.forEach(b => b.addEventListener('click', () => {
      if (View.dynMode === b.dataset.mode) return;
      View.dynMode = b.dataset.mode;
      View.statsKey = null;
      View.openCat = null;
      segs.forEach(x => setAttr(x, 'aria-selected', x === b ? 'true' : 'false'));
      moveThumb();
      Store.setSingleton('settings', { dynMode: View.dynMode });
      render({ animateMode: true });
    }));

    // Столбцы месяцев
    const barsHost = $('#dynBars');
    for (let i = 0; i < MONTH_COLS; i++) {
      const val  = el('span', { class: 'bar-val' });
      const fill = el('span', { class: 'bar-fill' }, [val]);
      const name = el('span', { class: 'bar-name' });
      const col = el('button', {
        class: 'bar-col', type: 'button', 'aria-pressed': 'false'
      }, [el('span', { class: 'bar-track' }, [fill]), name]);
      col.addEventListener('click', () => {
        View.statsKey = col.dataset.key;
        View.openCat = null;
        render();
      });
      barsHost.appendChild(col);
      barNodes.push({ col, val, fill, name });
    }

    // Строки года
    const hHost = $('#dynHBars');
    for (let m = 0; m < 12; m++) {
      const name = el('span', { class: 'hbar-name', text: MONTHS_SHORT[m] });
      const fill = el('span', { class: 'hbar-fill' });
      const val  = el('span', { class: 'hbar-val' });
      fill.appendChild(val);
      const row = el('button', {
        class: 'hbar', type: 'button', 'aria-pressed': 'false'
      }, [name, el('span', { class: 'hbar-track' }, [fill])]);
      row.addEventListener('click', () => {
        View.statsKey = View.statsKey === row.dataset.key ? null : row.dataset.key;
        View.openCat = null;
        render();
      });
      hHost.appendChild(row);
      hbarNodes.push({ row, fill, val, name });
    }

    // Полосы структуры в годовом режиме — по категориям, а не по месяцам
    const syHost = $('#structYearBars');
    syHost.classList.add('hbars--cats');
    for (let i = 0; i < YEAR_BARS; i++) {
      const name = el('span', { class: 'hbar-name' });
      const fill = el('span', { class: 'hbar-fill' });
      const val  = el('span', { class: 'hbar-val' });
      const row = el('div', { class: 'hbar' }, [name, el('span', { class: 'hbar-track' }, [fill]), val]);
      syHost.appendChild(row);
      structYearNodes.push({ row, fill, val, name });
    }

    buildDonut();
    requestAnimationFrame(() => { moveThumb(); requestAnimationFrame(() => seg.setAttribute('data-ready', '')); });
    window.addEventListener('resize', moveThumb);
  }

  /* ---------- Кольцевая диаграмма ---------- */

  const NS = 'http://www.w3.org/2000/svg';
  const RADIUS = 41;
  const CIRC = 2 * Math.PI * RADIUS;
  let donutSegs = [];

  function buildDonut() {
    if (donutBuilt) return;
    const svg = $('#donut');
    const track = document.createElementNS(NS, 'circle');
    track.setAttribute('cx', '50'); track.setAttribute('cy', '50');
    track.setAttribute('r', String(RADIUS));
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', 'var(--surface-sunk)');
    track.setAttribute('stroke-width', '13');
    svg.appendChild(track);
    // Пул сегментов создаётся заранее — пустых промежуточных состояний нет
    for (let i = 0; i <= DONUT_SLICES; i++) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', '50'); c.setAttribute('cy', '50');
      c.setAttribute('r', String(RADIUS));
      c.setAttribute('fill', 'none');
      c.setAttribute('stroke-width', '13');
      c.setAttribute('stroke-linecap', 'butt');
      c.setAttribute('stroke-dasharray', '0 ' + CIRC);
      c.style.transition = 'stroke-dasharray var(--dur-slow) var(--ease), stroke-dashoffset var(--dur-slow) var(--ease)';
      svg.appendChild(c);
      donutSegs.push(c);
    }
    donutBuilt = true;
  }

  /**
   * Категорий может быть много, а секторов и полос — ограниченное число.
   * Берём крупнейшие, остальное сводим в одну строку «Остальные».
   * Полный список всегда виден ниже, под диаграммой.
   */
  function topSlices(rows, limit) {
    if (rows.length <= limit) return rows;
    const head = rows.slice(0, limit - 1);
    const tail = rows.slice(limit - 1);
    const amount = tail.reduce((sum, r) => sum + r.amount, 0);
    const share = tail.reduce((sum, r) => sum + r.share, 0);
    return head.concat([{
      catId: '__rest',
      name: 'Остальные · ' + tail.length,
      color: '#C3CBC7',
      amount, share, items: []
    }]);
  }

  function paintDonut(rows, total) {
    let offset = 0;
    const gap = rows.length > 1 ? 1.2 : 0;   // «щель» между секторами
    donutSegs.forEach((c, i) => {
      const row = rows[i];
      if (!row || total <= 0) {
        c.setAttribute('stroke-dasharray', '0 ' + CIRC);
        return;
      }
      const len = Math.max(0, (row.amount / total) * CIRC - gap);
      c.setAttribute('stroke', row.color);
      c.setAttribute('stroke-dasharray', len + ' ' + (CIRC - len));
      c.setAttribute('stroke-dashoffset', String(-offset));
      offset += (row.amount / total) * CIRC;
    });
  }

  /* ---------- Отрисовка ---------- */

  function monthTotal(key) {
    return Data.totalsOf(key).total;
  }

  function replayChart(mode) {
    if (prefersReducedMotion()) return;
    const layer = mode === 'year' ? $('#dynYear') : $('#dynMonth');
    const nodes = mode === 'year' ? hbarNodes : barNodes;
    const attribute = mode === 'year' ? 'year' : 'month';
    layer.removeAttribute('data-chart-enter');
    nodes.forEach((n, i) => n.fill.style.setProperty('--chart-delay', Math.min(i * 24, 120) + 'ms'));
    requestAnimationFrame(() => {
      layer.setAttribute('data-chart-enter', attribute);
      clearTimeout(layer._chartEnterTimer);
      layer._chartEnterTimer = setTimeout(() => layer.removeAttribute('data-chart-enter'), 480);
    });
  }

  function render(opts) {
    const soft = opts && opts.soft;
    if (View.dynMode !== 'year') View.statsYear = yearOf(View.key);

    /* --- Аудит --- */
    const cur  = Data.totalsOf(View.key);
    const prev = Data.totalsOf(shiftKey(View.key, -1));
    const keys6 = Data.lastKeys(shiftKey(View.key, -1), 6);
    const sums6 = keys6.map(monthTotal);
    const avg6 = sums6.reduce((a, b) => a + b, 0) / 6;

    const active = Data.activeKeys();
    let bestKey = null, bestSum = 0;
    for (const k of active) {
      const s = monthTotal(k);
      if (s > bestSum) { bestSum = s; bestKey = k; }
    }

    const deltaNode = $('#auditDelta');
    deltaNode.innerHTML = '';
    if (prev.total === 0 && cur.total === 0) {
      deltaNode.className = 'audit-cell-value fade-swap delta--flat';
      deltaNode.append(document.createTextNode('—'),
        el('span', { class: 'sub', text: 'Нет данных за два месяца' }));
    } else {
      const diff = cur.total - prev.total;
      const pct = prev.total > 0 ? (diff / prev.total) * 100 : (cur.total > 0 ? 100 : 0);
      const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
      deltaNode.className = 'fade-swap delta--' + dir;
      deltaNode.append(
        document.createTextNode((diff > 0 ? '+' : diff < 0 ? '−' : '') + percent(Math.abs(pct), 0)),
        el('span', { class: 'sub', text: (diff >= 0 ? '+' : '−') + money(Math.abs(diff)) + ' к ' + MONTHS_DAT[monOf(shiftKey(View.key, -1))] })
      );
    }

    const avgNode = $('#auditAvg');
    avgNode.innerHTML = '';
    const span6 = MONTHS_SHORT[monOf(keys6[0])] + ' — ' + MONTHS_SHORT[monOf(keys6[5])] +
      (yearOf(keys6[0]) === yearOf(keys6[5]) ? ' ' + yearOf(keys6[5]) : ' ' + yearOf(keys6[0]) + '/' + yearOf(keys6[5]));
    avgNode.append(document.createTextNode(money(avg6)), el('span', { class: 'sub', text: span6 }));

    const bestNode = $('#auditBest');
    bestNode.innerHTML = '';
    bestNode.append(document.createTextNode(bestKey ? money(bestSum) : '—'),
      el('span', { class: 'sub', text: bestKey ? keyLabel(bestKey) : 'Пока нет записей' }));

    /* --- Динамика --- */
    const isYear = View.dynMode === 'year';
    setAttr($('#dynMonth'), 'data-shown', isYear ? null : true);
    setAttr($('#dynYear'),  'data-shown', isYear ? true : null);

    const selectedYear = isYear && View.statsKey && View.statsKey.startsWith('year:')
      ? Number(View.statsKey.slice(5)) : null;
    const scopeKey = !isYear ? (View.statsKey || View.key) : null;

    // Месячные столбцы
    const keys = Data.lastKeys(View.key, MONTH_COLS);
    const values = keys.map(monthTotal);
    const max = Math.max(1, ...values);
    keys.forEach((k, i) => {
      const n = barNodes[i];
      n.col.dataset.key = k;
      setText(n.name, MONTHS_SHORT[monOf(k)]);
      setText(n.val, values[i] > 0 ? barShort(values[i]) : '—');
      // Даже нулевой месяц остаётся видимым: минимальная высота задана в CSS
      n.fill.style.height = Math.max(4, (values[i] / max) * 88) + '%';
      setAttr(n.col, 'aria-pressed', (!isYear && k === scopeKey) ? 'true' : 'false');
      setAttr(n.col, 'data-current', k === View.todayKey ? true : null);
      setAttr(n.col, 'aria-label', keyLabel(k) + ': ' + money(values[i]));
    });

    // В режиме «Год» показываем именно годовые итоги, а не месяцы.
    const year = View.statsYear;
    const years = [];
    for (let i = 5; i >= 0; i--) years.push(year - i);
    const yearVals = years.map(y => Data.lastKeys(mkey(y, 11), 12).reduce((sum, k) => sum + monthTotal(k), 0));
    const yMax = Math.max(1, ...yearVals);
    hbarNodes.forEach((n, i) => {
      const y = years[i];
      const value = yearVals[i];
      const key = 'year:' + y;
      n.row.style.display = i < years.length ? '' : 'none';
      n.row.dataset.key = key;
      setText(n.name, String(y));
      n.fill.style.height = (value > 0 ? Math.max(3, (value / yMax) * 88) : 0) + '%';
      n.fill.style.width = '100%';
      setText(n.val, value > 0 ? barShort(value) : '—');
      setAttr(n.row, 'aria-pressed', (isYear && key === View.statsKey) ? 'true' : 'false');
      setAttr(n.row, 'data-current', y === year ? true : null);
      setAttr(n.row, 'aria-label', 'Доход за ' + y + ': ' + money(value));
    });
    for (let i = years.length; i < hbarNodes.length; i++) hbarNodes[i].row.style.display = 'none';

    if (opts && opts.animateMode) replayChart(isYear ? 'year' : 'month');

    /* --- Структура --- */
    // Годовой режим без выбранного месяца → структура за весь год
    const structureYear = selectedYear || year;
    const scope = isYear
      ? { type: 'year', year: structureYear }
      : { type: 'month', key: scopeKey };

    const data = Data.breakdown(scope);
    const scopeLabel = scope.type === 'year'
      ? String(scope.year) + ' · по месяцам'
      : keyLabel(scope.key);

    const applyScope = () => {
      setText($('#structScope'), scopeLabel);
      setText($('#structTotal'), money(data.total));
    };
    if (soft) { softSwap($('#structScope'), applyScope); } else { applyScope(); }

    const yearStruct = scope.type === 'year';
    setAttr($('#structDonutLayer'), 'data-shown', yearStruct ? null : true);
    setAttr($('#structYearLayer'),  'data-shown', yearStruct ? true : null);
    $('#structYearBars').classList.toggle('hbars--months', yearStruct);
    $('#structYearBars').classList.remove('hbars--cats');

    if (yearStruct) {
      const monthValues = Array.from({ length: 12 }, (_, m) => monthTotal(mkey(structureYear, m)));
      // В годовом режиме всегда показываем месяцы выбранного года.
      // Категориальные горизонтальные полосы дублировали этот экран и путали сценарий.
      const chartRows = monthValues.map((amount, m) => ({
        name: MONTHS_SHORT[m],
        amount,
        color: amount > 0 ? 'var(--accent)' : 'var(--surface-sunk)'
      }));
      const catMax = Math.max(1, ...chartRows.map(r => r.amount));
      structYearNodes.forEach((n, i) => {
        const row = chartRows[i];
        n.row.style.display = row ? '' : 'none';
        if (!row) return;
        setText(n.name, row.name);
        n.fill.style.height = (row.amount > 0 ? Math.max(3, (row.amount / catMax) * 100) : 0) + '%';
        n.fill.style.width = '100%';
        n.fill.style.background = row.color;
        setText(n.val, row.amount > 0 ? barShort(row.amount) : '—');
        setAttr(n.val, 'data-zero', row.amount > 0 ? null : true);
      });
    } else {
      paintDonut(topSlices(data.rows, DONUT_SLICES), data.total);
      const top = data.rows[0];
      setText($('#donutTopName'), top ? top.name : 'Нет данных');
      setText($('#donutTopShare'), top ? percent(top.share, 0) : '—');
    }

    renderCategories(data);
  }

  /* ---------- Список категорий с раскрытием внутри карточки ---------- */

  function renderCategories(data) {
    const host = $('#structList');
    const empty = $('#structEmpty');
    empty.hidden = data.rows.length > 0;

    const seen = new Set();
    data.rows.forEach((row, index) => {
      seen.add(row.catId);
      let entry = catNodes.get(row.catId);
      if (!entry) { entry = buildCategory(row.catId); catNodes.set(row.catId, entry); }
      paintCategory(entry, row);
      const at = host.children[index];
      if (at !== entry.item) host.insertBefore(entry.item, at || null);
    });
    for (const [id, entry] of catNodes) {
      if (seen.has(id)) continue;
      entry.item.remove();
      catNodes.delete(id);
    }
  }

  function buildCategory(catId) {
    const swatch = el('span', { class: 'cat-swatch' });
    const name   = el('span', { class: 'cat-name' });
    const share  = el('span', { class: 'cat-share' });
    const sum    = el('span', { class: 'cat-sum' });
    const chev   = el('span', { class: 'cat-chev' }, [icon('right', 15)]);

    const row = el('button', {
      class: 'cat-row', type: 'button', 'aria-expanded': 'false'
    }, [swatch, el('span', { style: 'min-width:0' }, [name, share]), sum, chev]);

    const sub = el('ul', { class: 'cat-sub' });
    const drawer = el('div', { class: 'cat-drawer' }, [
      el('div', { class: 'cat-drawer-inner' }, [sub])
    ]);

    const item = el('li', { class: 'cat-item' }, [row, drawer]);

    row.addEventListener('click', () => {
      View.openCat = View.openCat === catId ? null : catId;
      // Раскрываем без перерисовки всей страницы: меняем только этот узел
      for (const [id, e] of catNodes) {
        const on = id === View.openCat;
        setAttr(e.item, 'data-open', on ? true : null);
        setAttr(e.row, 'aria-expanded', on ? 'true' : 'false');
      }
    });

    return { item, row, swatch, name, share, sum, sub };
  }

  function paintCategory(entry, row) {
    entry.swatch.style.background = row.color;
    setText(entry.name, row.name);
    setText(entry.share, percent(row.share, 0) + ' · ' +
      row.items.length + ' ' + plural(row.items.length, 'запись', 'записи', 'записей'));
    setText(entry.sum, money(row.amount));

    entry.sub.innerHTML = '';
    for (const it of row.items) {
      entry.sub.appendChild(el('li', {}, [
        el('span', { style: 'min-width:0' }, [
          el('span', { class: 't', text: it.title }),
          el('span', {
            class: 'm',
            text: (it.status === 'received' ? 'получен' : 'ожидается') +
                  (View.dynMode === 'year' && !View.statsKey ? ' · ' + MONTHS_SHORT[monOf(it.monthKey)] : '')
          })
        ]),
        el('span', { class: 'a', text: money(it.amount) })
      ]));
    }
    const on = View.openCat === row.catId;
    setAttr(entry.item, 'data-open', on ? true : null);
    setAttr(entry.row, 'aria-expanded', on ? 'true' : 'false');
  }

  function remeasure() {
    const seg = $('#dynMode');
    if (!seg) return;
    seg.removeAttribute('data-ready');
    moveThumb();
    requestAnimationFrame(() => requestAnimationFrame(() => seg.setAttribute('data-ready', '')));
  }

  return { mount, render, remeasure };
})();
