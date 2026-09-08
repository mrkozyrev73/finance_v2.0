/* ============================================================
   Оболочка: вкладки, шапка месяца, листы, тосты
   ============================================================ */

/* ------------------------------------------------------------
   Тосты
   ------------------------------------------------------------ */

const Toast = (() => {
  let host = null;
  const alive = new Set();

  function show(text, opts) {
    if (!host) host = $('#toasts');
    if (!host) return;
    const o = opts || {};
    const node = el('div', { class: 'toast' + (o.kind === 'err' ? ' toast--err' : ''), role: 'status' }, [
      el('span', { class: 't', text: text })
    ]);
    let timer = 0;
    const close = () => {
      clearTimeout(timer);
      alive.delete(node);
      node.removeAttribute('data-in');
      setTimeout(() => node.remove(), 220);
    };
    if (o.action) {
      node.appendChild(el('button', {
        type: 'button',
        text: o.action.label,
        onclick: () => { o.action.run(); close(); }
      }));
    }
    host.appendChild(node);
    alive.add(node);
    requestAnimationFrame(() => node.setAttribute('data-in', ''));
    timer = setTimeout(close, o.duration || (o.action ? 6000 : 3200));
    // Не даём стопке разрастаться
    while (alive.size > 3) {
      const first = alive.values().next().value;
      alive.delete(first);
      first.remove();
    }
    return close;
  }

  return { show };
})();

/* ------------------------------------------------------------
   Модальный лист
   ------------------------------------------------------------ */

const Sheet = (() => {
  let node, scrim, titleEl, bodyEl, footEl, grabEl, closeBtn;
  let openState = null;
  let lastFocused = null;
  let closeTimer = 0;     // отложенное закрытие: его нельзя дать выполнить,
                          // если за это время открыли следующий лист
  let closeDone = null;

  function mount() {
    node = $('#sheet'); scrim = $('#scrim');
    titleEl = $('#sheetTitle'); bodyEl = $('#sheetBody');
    footEl = $('#sheetFoot'); grabEl = $('#sheetGrab'); closeBtn = $('#sheetClose');

    scrim.addEventListener('click', () => close());
    closeBtn.addEventListener('click', () => close());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && openState) { e.preventDefault(); close(); }
      if (e.key === 'Tab' && openState) trapFocus(e);
    });
    initDrag();
  }

  function trapFocus(e) {
    const focusables = $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', node)
      .filter(n => n.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* Свайп вниз для закрытия — 1:1 трекинг + проекция инерции */
  function initDrag() {
    let dragging = false, startY = 0, y = 0, height = 0;
    let samples = [];

    const onDown = (e) => {
      if (!openState) return;
      dragging = true;
      startY = e.clientY;
      y = 0;
      height = node.offsetHeight;
      samples = [{ t: performance.now(), y: e.clientY }];
      node.classList.remove('sheet-anim');
      grabEl.setPointerCapture(e.pointerId);
    };

    const onMove = (e) => {
      if (!dragging) return;
      const raw = e.clientY - startY;
      // Вверх — резиновое сопротивление, вниз — 1:1
      y = raw < 0 ? -rubberband(-raw, height) : raw;
      node.style.transform = 'translate(-50%,' + y + 'px)';
      samples.push({ t: performance.now(), y: e.clientY });
      if (samples.length > 6) samples.shift();
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      const last = samples[samples.length - 1], first = samples[0];
      const dt = Math.max(1, last.t - first.t);
      const velocity = (last.y - first.y) / dt * 1000;      // px/s
      const projected = y + projectMomentum(velocity);
      node.classList.add('sheet-anim');
      if (projected > height * 0.4) {
        node.style.transform = 'translate(-50%,' + height + 'px)';
        setTimeout(() => close(true), prefersReducedMotion() ? 0 : 180);
      } else {
        node.style.transform = 'translate(-50%,0)';
      }
    };

    grabEl.addEventListener('pointerdown', onDown);
    grabEl.addEventListener('pointermove', onMove);
    grabEl.addEventListener('pointerup', onUp);
    grabEl.addEventListener('pointercancel', onUp);
  }

  /**
   * open({ title, build(body), footer, onClose })
   * build получает контейнер и наполняет его.
   */
  function open(conf) {
    clearTimeout(closeTimer);
    closeTimer = 0;
    if (openState) closeNow();
    openState = conf;
    lastFocused = document.activeElement;

    setText(titleEl, conf.title || '');
    bodyEl.innerHTML = '';
    footEl.innerHTML = '';
    conf.build(bodyEl);

    if (conf.footer) {
      footEl.hidden = false;
      conf.footer(footEl);
    } else {
      footEl.hidden = true;
    }

    scrim.hidden = false;
    node.hidden = false;
    setAttr($('#toasts'), 'data-over-sheet', true);
    node.classList.remove('sheet-anim');
    node.style.transform = 'translate(-50%,100%)';
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        node.classList.add('sheet-anim');
        node.style.transform = 'translate(-50%,0)';
        scrim.setAttribute('data-open', '');
      });
    });

    // Не открываем клавиатуру автоматически: на iPhone это меняет visual
    // viewport во время появления листа и вызывает заметный рывок экрана.
    // Поле получает фокус только после явного нажатия пользователя.
  }

  function closeNow() {
    clearTimeout(closeTimer);
    closeTimer = 0;
    node.hidden = true;
    scrim.hidden = true;
    scrim.removeAttribute('data-open');
    setAttr($('#toasts'), 'data-over-sheet', null);
    node.style.transform = '';
    document.body.style.overflow = '';
    const conf = openState;
    openState = null;
    bodyEl.innerHTML = '';
    footEl.innerHTML = '';
    if (lastFocused && lastFocused.isConnected) lastFocused.focus({ preventScroll: true });
    if (conf && conf.onClose) conf.onClose();
    const done = closeDone;
    closeDone = null;
    if (done) done();
  }

  function close(immediate, done) {
    if (!openState) { if (done) done(); return; }
    closeDone = done || null;
    if (immediate || prefersReducedMotion()) { closeNow(); return; }
    node.classList.add('sheet-anim');
    node.style.transform = 'translate(-50%,100%)';
    scrim.removeAttribute('data-open');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(closeNow, 220);
  }

  return { mount, open, close, get isOpen() { return !!openState; } };
})();

/* ------------------------------------------------------------
   Подтверждение действия
   ------------------------------------------------------------ */

function confirmSheet(opts) {
  Sheet.open({
    title: opts.title,
    build(body) {
      body.appendChild(el('p', {
        class: 'section-sub',
        text: opts.text,
        style: 'margin:0 2px 4px;font-size:var(--fs-body);line-height:1.45'
      }));
    },
    footer(foot) {
      foot.appendChild(el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [
        el('button', { class: 'btn btn--ghost', type: 'button', text: 'Отмена', onclick: () => Sheet.close() }),
        el('button', {
          class: 'btn ' + (opts.danger ? 'btn--danger' : ''),
          type: 'button',
          text: opts.confirmLabel || 'Продолжить',
          onclick: () => { Sheet.close(false, opts.onConfirm); }
        })
      ]));
    }
  });
}

/* ------------------------------------------------------------
   Состояние экрана: выбранный месяц + активная вкладка
   ------------------------------------------------------------ */

const View = {
  key: mkey(new Date().getFullYear(), new Date().getMonth()),
  todayKey: mkey(new Date().getFullYear(), new Date().getMonth()),
  tab: 'home',
  filter: 'all',
  query: '',
  dynMode: 'month',
  statsKey: null,      // выбранный столбец в динамике
  statsYear: new Date().getFullYear(),
  openCat: null,
  openSwipeId: null,
  scroll: { home: 0, stats: 0, fin: 0, set: 0 }
};

/* ------------------------------------------------------------
   Вкладки
   ------------------------------------------------------------ */

const Tabs = (() => {
  let bar, pill, buttons;

  function mount() {
    bar = $('#tabbar');
    pill = $('.tab-pill', bar);
    buttons = $$('.tab', bar);

    buttons.forEach(btn => {
      btn.addEventListener('click', () => select(btn.dataset.tab));
    });

    // Позиция капсулы без анимации на первом кадре
    movePill(false);
    requestAnimationFrame(() => requestAnimationFrame(() => bar.setAttribute('data-ready', '')));
    window.addEventListener('resize', () => movePill(true));
  }

  function movePill() {
    const active = buttons.find(b => b.dataset.tab === View.tab) || buttons[0];
    pill.style.width = active.offsetWidth + 'px';
    pill.style.transform = 'translateX(' + active.offsetLeft + 'px)';
  }

  function select(tab) {
    if (View.tab === tab) {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    View.scroll[View.tab] = window.scrollY;
    View.tab = tab;

    buttons.forEach(b => setAttr(b, 'aria-selected', b.dataset.tab === tab ? 'true' : 'false'));
    $$('.screen').forEach(s => setAttr(s, 'data-active', s.id === 'scr-' + tab ? true : null));
    movePill();

    Render.all();
    window.scrollTo({ top: View.scroll[tab] || 0, behavior: 'auto' });

    Store.setSingleton('settings', { lastTab: tab });
  }

  return { mount, select, movePill };
})();

/* ------------------------------------------------------------
   Шапка месяца
   ------------------------------------------------------------ */

const MonthBar = (() => {
  function mount() {
    const prev = $('#monthPrev');
    const next = $('#monthNext');
    if (prev) prev.addEventListener('click', () => step(-1));
    if (next) next.addEventListener('click', () => step(1));
    $('#monthOpen').addEventListener('click', openPicker);
    document.addEventListener('keydown', (e) => {
      if (Sheet.isOpen) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    });
  }

  function step(delta) {
    setKey(shiftKey(View.key, delta));
  }

  /**
   * Смена месяца. Экран не пересобирается: обновляются значения
   * внутри существующих узлов, положение прокрутки сохраняется.
   */
  function setKey(key) {
    if (key === View.key) return;
    View.key = key;
    View.statsKey = null;
    View.statsYear = yearOf(key);
    View.openCat = null;
    Swipe.closeAll();
    Render.all({ soft: true });
  }

  function render() {
    const d = new Date();
    setText($('#weekday'), WEEKDAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS_GEN[d.getMonth()]);
    const monthLabel = $('#monthLabel');
    const nextLabel = keyLabel(View.key);
    if (monthLabel && monthLabel.textContent !== nextLabel) {
      softSwap(monthLabel, () => setText(monthLabel, nextLabel));
    }
    // Вперёд можно уходить максимум на 12 месяцев от текущего
    const limit = shiftKey(View.todayKey, 12);
    if ($('#monthNext')) setAttr($('#monthNext'), 'disabled', View.key >= limit ? true : null);
  }

  function openPicker() {
    let year = yearOf(View.key);
    Sheet.open({
      title: 'Выбор месяца',
      build(body) {
        const pager = el('div', { class: 'year-pager' });
        const prev = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Предыдущий год' }, [icon('left')]);
        const next = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Следующий год' }, [icon('right')]);
        const label = el('b', { text: String(year) });
        pager.append(prev, label, next);

        const grid = el('div', { class: 'month-grid' });
        body.append(pager, grid);

        const paint = () => {
          setText(label, String(year));
          grid.innerHTML = '';
          for (let m = 0; m < 12; m++) {
            const k = mkey(year, m);
            const cell = el('button', {
              class: 'month-cell',
              type: 'button',
              'aria-pressed': k === View.key ? 'true' : 'false',
              text: MONTHS_NOM[m]
            });
            if (k === View.todayKey) cell.setAttribute('data-today', '');
            cell.addEventListener('click', () => { setKey(k); Sheet.close(); });
            grid.appendChild(cell);
          }
        };
        prev.addEventListener('click', () => { year--; paint(); });
        next.addEventListener('click', () => { year++; paint(); });
        paint();
      },
      footer(foot) {
        foot.appendChild(el('button', {
          class: 'btn btn--ghost btn--block', type: 'button', text: 'Текущий месяц',
          onclick: () => { setKey(View.todayKey); Sheet.close(); }
        }));
      }
    });
  }

  return { mount, render, setKey, step };
})();
