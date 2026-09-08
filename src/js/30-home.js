/* ============================================================
   Главная: итоги, список доходов, свайп-действия, форма
   ============================================================ */

/* ------------------------------------------------------------
   Свайп строки — 1:1 трекинг, резина на границах, проекция инерции
   ------------------------------------------------------------ */

const Swipe = (() => {
  const ACTIONS_W = 136;      // две кнопки по 68
  const THRESHOLD = 10;       // гистерезис до захвата направления
  const open = new Map();     // id -> {row, body}

  function attach(row, body, id) {
    let active = false, locked = null, startX = 0, startY = 0;
    let base = 0, x = 0, samples = [];

    const setX = (v) => {
      x = v;
      body.style.transform = 'translateX(' + v + 'px)';
    };

    const settle = (to, velocity = 0) => {
      const distance = Math.abs(to - x);
      const speed = Math.max(220, Math.abs(velocity));
      const duration = distance
        ? Math.max(140, Math.min(300, distance / speed * 1000 * .9))
        : 180;
      body.style.setProperty('--swipe-settle-duration', duration + 'ms');
      row.setAttribute('data-settling', '');
      setX(to);
      if (to < 0) { open.set(id, { row, body }); row.setAttribute('data-open', ''); }
      else { open.delete(id); row.removeAttribute('data-open'); }
      clearTimeout(row._settleT);
      row._settleT = setTimeout(() => {
        row.removeAttribute('data-settling');
        if (to === 0) row.removeAttribute('data-dragging');
      }, duration + 30);
    };

    body.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      active = true; locked = null;
      startX = e.clientX; startY = e.clientY;
      base = open.has(id) ? -ACTIONS_W : 0;
      samples = [{ t: performance.now(), x: e.clientX }];
      row.removeAttribute('data-settling');
      body.style.removeProperty('--swipe-settle-duration');
    });

    body.addEventListener('pointermove', (e) => {
      if (!active) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (locked === null) {
        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
        // Направление определяется один раз и больше не меняется
        locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (locked === 'x') {
          body.setPointerCapture(e.pointerId);
          row.setAttribute('data-dragging', '');
          closeOthers(id);
        }
      }
      if (locked !== 'x') return;

      let next = base + dx;
      if (next > 0) next = rubberband(next, ACTIONS_W);              // тянем вправо — резина
      else if (next < -ACTIONS_W) {
        next = -ACTIONS_W - rubberband(-ACTIONS_W - next, ACTIONS_W); // и влево тоже
      }
      setX(next);
      samples.push({ t: performance.now(), x: e.clientX });
      if (samples.length > 6) samples.shift();
    });

    const finish = () => {
      if (!active) return;
      const wasX = locked === 'x';
      active = false; locked = null;
      if (!wasX) return;

      // Мышь дошлёт click после перетаскивания — его надо съесть,
      // иначе жест тут же откатится или откроется форма.
      row._afterDrag = true;

      const last = samples[samples.length - 1], first = samples[0];
      const dt = Math.max(1, last.t - first.t);
      const velocity = (last.x - first.x) / dt * 1000;
      const projected = x + projectMomentum(velocity);
      settle(projected < -ACTIONS_W / 2 ? -ACTIONS_W : 0, velocity);
    };

    body.addEventListener('pointerup', finish);
    body.addEventListener('pointercancel', finish);

    body.addEventListener('click', (e) => {
      if (row._afterDrag) {
        row._afterDrag = false;
        e.preventDefault(); e.stopPropagation();
        return;
      }
      // Пока панель открыта, тап по телу строки её закрывает
      if (open.has(id)) { e.preventDefault(); e.stopPropagation(); settle(0); }
    }, true);

    row._closeSwipe = () => settle(0);
    row._resetSwipe = () => {
      open.delete(id);
      row.removeAttribute('data-settling');
      row.removeAttribute('data-dragging');
      row.removeAttribute('data-open');
      body.style.removeProperty('--swipe-settle-duration');
      setX(0);
    };
  }

  function closeOthers(id) {
    for (const [key, entry] of open) {
      if (key !== id) entry.row._closeSwipe();
    }
  }

  function closeAll() {
    for (const [, entry] of open) entry.row._closeSwipe();
    open.clear();
  }

  document.addEventListener('pointerdown', (e) => {
    if (!open.size) return;
    if (e.target.closest && e.target.closest('.swipe')) return;
    closeAll();
  }, true);

  return { attach, closeAll, ACTIONS_W };
})();

/* ------------------------------------------------------------
   Список доходов с сохранением узлов (keyed reconcile)
   ------------------------------------------------------------ */

const IncomeList = (() => {
  const nodes = new Map();   // id -> {row, refs}

  function build(rec) {
    const actions = el('div', { class: 'swipe-actions' }, [
      el('button', {
        class: 'swipe-action swipe-action--edit', type: 'button',
        'aria-label': 'Изменить доход',
        onclick: (e) => { e.stopPropagation(); Swipe.closeAll(); IncomeForm.open(rec.id); }
      }, [icon('pencil'), el('span', { text: 'Изменить' })]),
      el('button', {
        class: 'swipe-action swipe-action--del', type: 'button',
        'aria-label': 'Удалить доход',
        onclick: (e) => { e.stopPropagation(); Swipe.closeAll(); deleteIncome(rec.id); }
      }, [icon('trash'), el('span', { text: 'Удалить' })])
    ]);

    const check = icon('check');
    check.classList.add('status-check');
    check.setAttribute('viewBox', '0 0 24 24');
    check.setAttribute('fill', 'none');
    check.setAttribute('stroke', 'currentColor');
    check.setAttribute('stroke-width', '2.2');
    check.setAttribute('stroke-linecap', 'round');
    check.setAttribute('stroke-linejoin', 'round');
    const checkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    checkPath.setAttribute('d', 'm5 12.6 4.6 4.6L19 7.4');
    check.replaceChildren(checkPath);
    const dot = el('button', {
      class: 'status-dot', type: 'button', 'aria-pressed': 'false'
    }, [check]);
    dot.addEventListener('click', (e) => {
      e.stopPropagation();          // тап по галочке не открывает форму
      toggleReceived(rec.id);
    });
    const title   = el('p', { class: 'income-title' });
    const newBadge = el('span', { class: 'income-new-badge', text: 'Новый' });
    const meta    = el('p', { class: 'income-meta' });
    const amount  = el('p', { class: 'income-amount' });
    const flag    = el('span', { class: 'income-flag' });

    const body = el('div', { class: 'swipe-body' }, [
      el('article', { class: 'income' }, [
        dot,
        el('div', { class: 'income-main' }, [title, meta]),
        el('div', { class: 'income-side' }, [amount, flag])
      ])
    ]);

    const row = el('div', { class: 'swipe' }, [actions, body]);
    row.setAttribute('data-enter', '');
    requestAnimationFrame(() => row.removeAttribute('data-enter'));
    Swipe.attach(row, body, rec.id);

    // Двойной путь: тап по строке открывает редактирование
    body.addEventListener('click', () => IncomeForm.open(rec.id));

    title.appendChild(newBadge);
    return { row, dot, check, title, newBadge, meta, amount, flag, painted: false, wasReceived: false };
  }

  function paint(entry, rec) {
    const received = rec.status === 'received';
    const shouldDrawCheck = entry.painted && received && !entry.wasReceived;
    // Меняется только цвет: иконка на месте, геометрия не дрожит
    entry.dot.className = 'status-dot ' + (received ? 'status-dot--received' : 'status-dot--expected');
    setAttr(entry.dot, 'aria-pressed', received ? 'true' : 'false');
    setAttr(entry.dot, 'aria-label', received ? 'Вернуть в ожидаемые' : 'Отметить полученным');
    setAttr(entry.dot, 'title', received ? 'Получен — нажмите, чтобы вернуть в ожидаемые'
                                         : 'Ожидается — нажмите, чтобы отметить полученным');

    entry.check.classList.toggle('status-check--drawn', received);
    if (shouldDrawCheck && !prefersReducedMotion()) {
      entry.check.classList.remove('status-check--drawn');
      entry.dot.classList.add('status-dot--drawing');
      requestAnimationFrame(() => entry.check.classList.add('status-check--drawn'));
    }
    entry.painted = true;
    entry.wasReceived = received;

    setText(entry.title, rec.title || 'Без названия');
    entry.title.appendChild(entry.newBadge);
    entry.newBadge.hidden = !(rec.status === 'expected' && rec.createdAt && now() - rec.createdAt < 30 * 60 * 1000);

    entry.meta.innerHTML = '';
    entry.meta.append(document.createTextNode(Data.categoryName(rec.categoryId)));
    if (rec.recurringId) {
      entry.meta.append(el('span', { class: 'sep', text: '·' }), document.createTextNode('каждый месяц'));
    }

    setText(entry.amount, money(rec.amount));
    entry.flag.className = 'income-flag' + (received ? '' : ' income-flag--expected');
    setText(entry.flag, received ? 'Получен' : 'Ожидается');
  }

  function render(list) {
    const host = $('#incomeList');
    const seen = new Set();

    list.forEach((rec, index) => {
      seen.add(rec.id);
      let entry = nodes.get(rec.id);
      if (!entry) {
        entry = build(rec);
        nodes.set(rec.id, entry);
      }
      paint(entry, rec);
      // Ставим на нужное место, только если оно изменилось
      const at = host.children[index];
      if (at !== entry.row) host.insertBefore(entry.row, at || null);
    });

    for (const [id, entry] of nodes) {
      if (seen.has(id)) continue;
      entry.row.remove();
      nodes.delete(id);
    }

    const empty = $('#incomeEmpty');
    empty.hidden = list.length > 0;
    if (!list.length) {
      setText(empty, View.query
        ? 'Ничего не нашлось по запросу «' + View.query + '»'
        : View.filter === 'expected' ? 'Ожидаемых доходов нет'
        : View.filter === 'received' ? 'Полученных доходов нет'
        : 'Доходов за этот месяц пока нет');
    }
  }

  return { render, reset: () => nodes.clear() };
})();

/** Отметить доход полученным или вернуть в ожидаемые — прямо из строки */
function toggleReceived(id) {
  const rec = Store.byId('incomes', id);
  if (!rec) return;
  const before = Data.totalsOf(View.key);
  const next = rec.status === 'received' ? 'expected' : 'received';
  Store.patch('incomes', id, { status: next }, rec.title);
  const after = Data.totalsOf(View.key);
  Home.animateTotals(before, after);
  Toast.show(next === 'received'
    ? '«' + (rec.title || 'Доход') + '» отмечен полученным'
    : '«' + (rec.title || 'Доход') + '» снова ожидается', {
    action: { label: 'Отменить', run: () => Store.patch('incomes', id, { status: rec.status }, rec.title) }
  });
}

function deleteIncome(id) {
  const rec = Store.byId('incomes', id);
  if (!rec) return;
  Store.remove('incomes', id, rec.title);
  Toast.show('«' + (rec.title || 'Доход') + '» в корзине', {
    action: { label: 'Вернуть', run: () => Store.restore('incomes', id) }
  });
}

/* ------------------------------------------------------------
   Форма дохода
   ------------------------------------------------------------ */

const IncomeForm = (() => {
  function open(id) {
    const editing = id ? Store.byId('incomes', id) : null;
    const cats = Data.categories();

    const draft = {
      title:      editing ? editing.title : '',
      amount:     editing ? editing.amount : '',
      status:     editing ? editing.status : 'expected',
      categoryId: editing ? editing.categoryId : (cats[0] && cats[0].id) || '',
      date:       editing ? editing.date : defaultDate(),
      repeat:     editing ? !!editing.recurringId : false
    };

    Sheet.open({
      title: editing ? 'Изменить доход' : 'Новый доход',
      build(body) {
        /* Сумма */
        const amountInput = el('input', {
          class: 'input input--amount', type: 'text', inputmode: 'decimal',
          id: 'f-amount', placeholder: '0', 'data-autofocus': true,
          value: draft.amount === '' ? '' : nf0.format(draft.amount)
        });
        amountInput.addEventListener('input', () => {
          const n = parseNum(amountInput.value);
          draft.amount = n;
          const caretAtEnd = amountInput.selectionStart === amountInput.value.length;
          const formatted = amountInput.value.trim() === '' ? '' : nf0.format(n);
          if (formatted !== amountInput.value) {
            amountInput.value = formatted;
            if (caretAtEnd) amountInput.setSelectionRange(formatted.length, formatted.length);
          }
        });
        body.appendChild(field('Сумма, ₽', amountInput, 'f-amount'));

        /* Статус — переключатель фиксированной высоты */
        const statusSeg = segmented([
          { value: 'expected', label: 'Ожидается' },
          { value: 'received', label: 'Уже получен' }
        ], draft.status, (v) => { draft.status = v; });
        statusSeg.classList.add('segmented--status');
        body.appendChild(field('Статус', statusSeg));

        /* Категория: список + быстрые кнопки */
        const catSelect = el('select', { class: 'select', id: 'f-cat' },
          cats.map(c => el('option', { value: c.id, text: c.name, selected: c.id === draft.categoryId })));
        if (!cats.length) catSelect.appendChild(el('option', { value: '', text: 'Категорий нет' }));

        // Недавно использованные — первыми; строка листается пальцем
        const quick = el('div', { class: 'quick-cats' });
        const quickWrap = el('div', { class: 'quick-wrap' }, [quick]);

        const syncQuick = (scroll) => {
          $$('.quick-cat', quick).forEach(b => {
            const on = b.dataset.id === draft.categoryId;
            setAttr(b, 'aria-pressed', on ? 'true' : 'false');
            if (on && scroll) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          });
        };

        Data.recentCategories().forEach(c => {
          const b = el('button', {
            class: 'quick-cat', type: 'button', text: c.name, 'aria-pressed': 'false',
            style: '--dot:' + c.color + ';--tint:' + c.color + '1f'
          });
          b.dataset.id = c.id;
          b.addEventListener('click', () => {
            draft.categoryId = c.id;
            catSelect.value = c.id;
            syncQuick();
          });
          quick.appendChild(b);
        });

        catSelect.addEventListener('change', () => {
          draft.categoryId = catSelect.value;
          syncQuick(true);
        });

        const updateFade = () => {
          const more = quick.scrollWidth - quick.clientWidth - quick.scrollLeft > 8;
          setAttr(quickWrap, 'data-more', more ? true : null);
        };
        quick.addEventListener('scroll', updateFade, { passive: true });

        const catField = field('Категория', catSelect, 'f-cat');
        catField.appendChild(quickWrap);
        body.appendChild(catField);

        // Измеряем после того, как лист показан
        requestAnimationFrame(() => {
          requestAnimationFrame(() => { syncQuick(true); updateFade(); });
        });

        /* Название */
        const titleInput = el('input', {
          class: 'input', type: 'text', id: 'f-title', value: draft.title,
          placeholder: 'Например, аванс', autocomplete: 'off'
        });
        titleInput.addEventListener('input', () => { draft.title = titleInput.value; });
        body.appendChild(field('Название дохода', titleInput, 'f-title'));

        /* Повторение */
        const sw = el('button', {
          class: 'switch', type: 'button', role: 'switch',
          'aria-checked': draft.repeat ? 'true' : 'false',
          'aria-label': 'Повторять каждый месяц'
        });
        sw.addEventListener('click', () => {
          draft.repeat = !draft.repeat;
          setAttr(sw, 'aria-checked', draft.repeat ? 'true' : 'false');
        });
        body.appendChild(el('div', { class: 'field' }, [
          el('div', { class: 'switch-row' }, [
            el('span', {}, [
              el('span', { class: 't', text: 'Повторять каждый месяц' }),
              el('span', { class: 's', text: 'Доход появится в следующих месяцах' })
            ]),
            sw
          ])
        ]));
      },

      footer(foot) {
        const save = el('button', { class: 'btn btn--block', type: 'button', text: 'Сохранить' });
        save.addEventListener('click', () => submit(editing, draft));
        foot.appendChild(save);
        if (editing) {
          foot.appendChild(el('button', {
            class: 'btn btn--ghost btn--block', type: 'button', text: 'Удалить доход',
            style: 'margin-top:8px;color:var(--danger)',
            onclick: () => { Sheet.close(false, () => deleteIncome(editing.id)); }
          }));
        }
      }
    });
  }

  function defaultDate() {
    return isoDate(new Date());
  }

  function submit(editing, draft) {
    if (!draft.amount || draft.amount <= 0) {
      Toast.show('Укажите сумму дохода', { kind: 'err' });
      return;
    }
    const payload = {
      title: (draft.title || '').trim() || Data.categoryName(draft.categoryId),
      amount: draft.amount,
      status: draft.status,
      categoryId: draft.categoryId,
      date: draft.date
    };

    if (editing) {
      const recurringId = syncRecurring(editing.recurringId, draft, payload);
      Store.patch('incomes', editing.id, Object.assign({}, payload, { recurringId }), payload.title);
      Toast.show('Изменения сохранены');
    } else {
      const recurringId = syncRecurring(null, draft, payload);
      Store.add('incomes', Object.assign({}, payload, { recurringId }), payload.title);
      Toast.show('Доход добавлен');
    }

    // Если доход перенесли в другой месяц — показываем его там
    const key = keyOf(payload.date);
    if (key !== View.key) MonthBar.setKey(key);

    Sheet.close();
  }

  /** Создаёт/обновляет/снимает шаблон регулярного дохода */
  function syncRecurring(currentId, draft, payload) {
    if (draft.repeat) {
      const tpl = {
        title: payload.title,
        amount: payload.amount,
        categoryId: payload.categoryId,
        day: parseInt(payload.date.slice(8, 10), 10) || 1,
        startKey: keyOf(payload.date),
        status: 'expected'
      };
      if (currentId && Store.byId('recurring', currentId)) {
        Store.patch('recurring', currentId, tpl, tpl.title);
        return currentId;
      }
      return Store.add('recurring', tpl, tpl.title).id;
    }
    if (currentId && Store.byId('recurring', currentId)) {
      Store.remove('recurring', currentId, payload.title);
    }
    return null;
  }

  return { open };
})();

/* ------------------------------------------------------------
   Материализация регулярных доходов в просматриваемом месяце
   ------------------------------------------------------------ */

function ensureRecurring(key) {
  const templates = Store.list('recurring');
  if (!templates.length) return;

  const created = [];
  for (const tpl of templates) {
    if (!tpl.startKey || key < tpl.startKey) continue;
    if (key === tpl.startKey) continue;                  // исходный месяц уже имеет запись
    // Уже есть запись (в том числе удалённая — значит пользователь её убрал сознательно)
    const exists = (Store.state.incomes || []).some(
      r => r.recurringId === tpl.id && keyOf(r.date) === key);
    if (exists) continue;

    const daysInMonth = new Date(yearOf(key), monOf(key) + 1, 0).getDate();
    const day = String(Math.min(tpl.day || 1, daysInMonth)).padStart(2, '0');
    created.push(stampNew({
      title: tpl.title,
      amount: tpl.amount,
      status: 'expected',
      categoryId: tpl.categoryId,
      date: key + '-' + day,
      recurringId: tpl.id
    }));
  }

  if (created.length) {
    Store.update(s => { s.incomes.push(...created); }, 'recurring');
  }
}

/* ------------------------------------------------------------
   Отрисовка главной
   ------------------------------------------------------------ */

const Home = (() => {
  function mount() {
    $('#addIncome').addEventListener('click', () => IncomeForm.open(null));

    $$('#incomeFilters .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        View.filter = chip.dataset.filter;
        $$('#incomeFilters .chip').forEach(c =>
          setAttr(c, 'aria-pressed', c === chip ? 'true' : 'false'));
        Swipe.closeAll();
        render();
      });
    });

    const search = $('#incomeSearch');
    const wrap = $('#incomeSearchWrap');
    const onInput = debounce(() => {
      View.query = search.value.trim();
      setAttr(wrap, 'data-filled', search.value ? true : null);
      Swipe.closeAll();
      render();
    }, 120);
    search.addEventListener('input', onInput);
    $('#incomeSearchClear').addEventListener('click', () => {
      search.value = '';
      View.query = '';
      wrap.removeAttribute('data-filled');
      render();
      search.focus();
    });
  }

  function filtered() {
    let list = Data.incomesOf(View.key);
    if (View.filter !== 'all') list = list.filter(r => r.status === View.filter);
    if (View.query) {
      const q = View.query.toLowerCase();
      list = list.filter(r =>
        (r.title || '').toLowerCase().includes(q) ||
        Data.categoryName(r.categoryId).toLowerCase().includes(q));
    }
    // Две понятные группы: ожидаемые сверху, полученные ниже.
    // Внутри группы последняя изменённая запись становится первой.
    return list.slice().sort((a, b) => {
      const groupA = a.status === 'expected' ? 0 : 1;
      const groupB = b.status === 'expected' ? 0 : 1;
      if (groupA !== groupB) return groupA - groupB;
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
  }

  function render(opts) {
    const totals = Data.totalsOf(View.key);
    const soft = opts && opts.soft;

    const apply = () => {
      setText($('#heroReceived'), money(totals.received));
      setText($('#heroExpected'), money(totals.expected));
      setText($('#heroTotal'), money(totals.total));
    };
    if (soft) {
      softSwap($('#heroReceived'), apply);
      softSwap($('#heroExpected'), () => {});
      softSwap($('#heroTotal'), () => {});
    } else {
      apply();
    }

    const all = Data.incomesOf(View.key);
    const counts = {
      all: all.length,
      expected: all.filter(r => r.status === 'expected').length,
      received: all.filter(r => r.status === 'received').length
    };
    for (const k in counts) setText($('[data-count="' + k + '"]'), counts[k]);

    const statusText = !all.length ? 'Записей нет'
      : counts.expected === 0 ? 'Всё получено'
      : counts.expected + ' ' + plural(counts.expected, 'доход ожидается', 'дохода ожидаются', 'доходов ожидаются');
    setAttr($('#incomeStatus'), 'data-state', !all.length ? 'empty' : counts.expected ? 'expected' : 'received');
    softSwap($('#incomeStatus'), () => setText($('#incomeStatus'), statusText));

    IncomeList.render(filtered());
  }

  let countFrame = 0;

  function animateTotals(from, to) {
    const nodes = [
      [$('#heroReceived'), from.received, to.received],
      [$('#heroExpected'), from.expected, to.expected],
      [$('#heroTotal'), from.total, to.total]
    ];
    if (prefersReducedMotion()) {
      nodes.forEach(([node, , value]) => setText(node, money(value)));
      return;
    }
    cancelAnimationFrame(countFrame);
    const started = performance.now();
    const duration = 240;
    const tick = (time) => {
      const progress = Math.min(1, (time - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      nodes.forEach(([node, fromValue, toValue]) => {
        setText(node, money(fromValue + (toValue - fromValue) * eased));
      });
      if (progress < 1) countFrame = requestAnimationFrame(tick);
    };
    countFrame = requestAnimationFrame(tick);
  }

  return { mount, render, animateTotals };
})();

/* ------------------------------------------------------------
   Мелкие конструкторы форм
   ------------------------------------------------------------ */

function field(labelText, control, forId) {
  const wrap = el('div', { class: 'field' });
  wrap.appendChild(el('label', { class: 'field-label', for: forId || null, text: labelText }));
  wrap.appendChild(control);
  return wrap;
}

function segmented(options, value, onChange) {
  const wrap = el('div', {
    class: 'segmented',
    style: 'grid-template-columns:repeat(' + options.length + ',1fr)'
  });
  const thumb = el('span', { class: 'segmented-thumb', 'aria-hidden': 'true' });
  wrap.appendChild(thumb);

  const buttons = options.map(opt => {
    const b = el('button', {
      class: 'seg', type: 'button', role: 'tab', text: opt.label,
      'aria-selected': opt.value === value ? 'true' : 'false'
    });
    b.dataset.value = opt.value;
    b.addEventListener('click', () => {
      buttons.forEach(x => setAttr(x, 'aria-selected', x === b ? 'true' : 'false'));
      move(b);
      onChange(opt.value);
    });
    wrap.appendChild(b);
    return b;
  });

  function move(active) {
    thumb.style.width = active.offsetWidth + 'px';
    thumb.style.transform = 'translateX(' + (active.offsetLeft - 3) + 'px)';
  }

  requestAnimationFrame(() => {
    const active = buttons.find(b => b.getAttribute('aria-selected') === 'true') || buttons[0];
    move(active);
    requestAnimationFrame(() => wrap.setAttribute('data-ready', ''));
  });

  return wrap;
}
