/* ============================================================
   Финансы: сейф, вклады, кредиты, досрочное погашение
   ============================================================ */

/* ---------- Аннуитетная математика ---------- */

const Loan = {
  /** Ежемесячная ставка из годовой в процентах */
  rate(annualPercent) { return (Number(annualPercent) || 0) / 100 / 12; },

  /** Срок в месяцах при заданном платеже */
  months(principal, i, payment) {
    if (principal <= 0 || payment <= 0) return 0;
    if (i <= 0) return principal / payment;
    if (payment <= principal * i) return Infinity;   // платёж не покрывает проценты
    return -Math.log(1 - (principal * i) / payment) / Math.log(1 + i);
  },

  /** Платёж при заданном сроке */
  payment(principal, i, months) {
    if (principal <= 0 || months <= 0) return 0;
    if (i <= 0) return principal / months;
    return (principal * i) / (1 - Math.pow(1 + i, -months));
  },

  /** Переплата за весь срок */
  overpay(principal, i, payment) {
    const n = Loan.months(principal, i, payment);
    if (!isFinite(n)) return Infinity;
    return payment * n - principal;
  }
};

function monthsLabel(n) {
  if (!isFinite(n)) return 'не гасится';
  const total = Math.ceil(n);
  const y = Math.floor(total / 12), m = total % 12;
  const parts = [];
  if (y) parts.push(y + ' ' + plural(y, 'год', 'года', 'лет'));
  if (m) parts.push(m + ' ' + plural(m, 'месяц', 'месяца', 'месяцев'));
  return parts.join(' ') || 'меньше месяца';
}

/* ------------------------------------------------------------
   Экран «Финансы»
   ------------------------------------------------------------ */

const Fin = (() => {
  const depNodes = new Map();
  const credNodes = new Map();

  function mount() {
    $('#safeCard').addEventListener('click', openSafe);
    $('#safeAdd').addEventListener('click', openSafe);
    $('#depAdd').addEventListener('click', () => openDeposit(null));
    $('#creditAdd').addEventListener('click', () => openCredit(null));
  }

  function openMenu() {
    Sheet.open({
      title: 'Добавить',
      build(body) {
        const list = el('div', { class: 'list' });
        const add = (label, note, ico, run) => {
          const b = el('button', { class: 'list-row', type: 'button' }, [
            el('span', { class: 'list-ico' }, [icon(ico)]),
            el('span', {}, [
              el('span', { class: 'list-label', text: label }),
              note ? el('span', { class: 'list-note', text: note }) : null
            ]),
            el('span', { class: 'list-side' }, [icon('right', 16)])
          ]);
          b.addEventListener('click', () => { Sheet.close(); setTimeout(run, 90); });
          list.appendChild(b);
        };
        add('Вклад', 'Название, банк, сумма, ставка', 'coins', () => openDeposit(null));
        add('Кредит', 'Остаток, ставка, ежемесячный платёж', 'bank', () => openCredit(null));
        body.appendChild(list);
      }
    });
  }


  /* ---------- Сейф ---------- */

  function openSafe() {
    const safe = Store.state.safe;
    const draft = { name: safe.name, amount: safe.amount };
    Sheet.open({
      title: 'Сейф',
      build(body) {
        const nameInput = el('input', { class: 'input', id: 's-name', value: draft.name, 'data-autofocus': true });
        nameInput.addEventListener('input', () => { draft.name = nameInput.value; });
        nameInput.addEventListener('focus', () => nameInput.select(), { once: true });
        body.appendChild(field('Название', nameInput, 's-name'));

        const amt = el('input', {
          class: 'input input--amount', id: 's-amt', type: 'text', inputmode: 'decimal',
          value: nf0.format(safe.amount || 0)
        });
        amt.addEventListener('input', () => { draft.amount = parseNum(amt.value); });
        body.appendChild(field('Сумма, ₽', amt, 's-amt'));
      },
      footer(foot) {
        foot.appendChild(el('button', {
          class: 'btn btn--block', type: 'button', text: 'Сохранить',
          onclick: () => {
            Store.setSingleton('safe', { name: draft.name.trim() || 'Наличные дома', amount: draft.amount });
            Store.recordFinanceSnapshot();
            Sheet.close();
            Toast.show('Сейф обновлён');
          }
        }));
      }
    });
  }

  /* ---------- Вклады ---------- */

  function openDeposit(id) {
    const rec = id ? Store.byId('deposits', id) : null;
    const draft = {
      name: rec ? rec.name : '',
      bank: rec ? rec.bank : '',
      amount: rec ? rec.amount : 0,
      rate: rec ? rec.rate : 0,
      endsAt: rec ? rec.endsAt || '' : ''
    };
    Sheet.open({
      title: rec ? 'Изменить вклад' : 'Новый вклад',
      build(body) {
        body.appendChild(field('Название', bind('d-name', draft, 'name', { placeholder: 'Накопительный' }, true), 'd-name'));
        body.appendChild(field('Банк', bind('d-bank', draft, 'bank', { placeholder: 'Например, Т-Банк' }), 'd-bank'));
        body.appendChild(field('Сумма, ₽', bindAmount('d-amt', draft, 'amount'), 'd-amt'));
        body.appendChild(el('div', { class: 'field' }, [
          el('div', { class: 'field-row' }, [
            el('div', {}, [
              el('label', { class: 'field-label', for: 'd-rate', text: 'Ставка, %' }),
              bindNumber('d-rate', draft, 'rate')
            ]),
            el('div', {}, [
              el('label', { class: 'field-label', for: 'd-ends', text: 'Окончание' }),
              bind('d-ends', draft, 'endsAt', { type: 'date' })
            ])
          ])
        ]));
      },
      footer(foot) {
        foot.appendChild(el('button', {
          class: 'btn btn--block', type: 'button', text: 'Сохранить',
          onclick: () => {
            if (!draft.name.trim()) { Toast.show('Укажите название вклада', { kind: 'err' }); return; }
            const payload = {
              name: draft.name.trim(), bank: draft.bank.trim(),
              amount: draft.amount, rate: draft.rate, endsAt: draft.endsAt
            };
            if (rec) Store.patch('deposits', rec.id, payload, payload.name);
            else Store.add('deposits', payload, payload.name);
            Store.recordFinanceSnapshot();
            Sheet.close();
            Toast.show(rec ? 'Вклад обновлён' : 'Вклад добавлен');
          }
        }));
        if (rec) {
          foot.appendChild(el('button', {
            class: 'btn btn--ghost btn--block', type: 'button', text: 'Удалить вклад',
            style: 'margin-top:8px;color:var(--danger)',
            onclick: () => {
              Sheet.close();
              setTimeout(() => {
                Store.remove('deposits', rec.id, rec.name);
                Store.recordFinanceSnapshot();
                Toast.show('Вклад в корзине', {
                  action: { label: 'Вернуть', run: () => Store.restore('deposits', rec.id) }
                });
              }, 80);
            }
          }));
        }
      }
    });
  }

  function depositDetail(id) {
    const rec = Store.byId('deposits', id);
    if (!rec) return;
    const yearly = (rec.amount || 0) * (rec.rate || 0) / 100;
    Sheet.open({
      title: rec.name,
      build(body) {
        body.appendChild(kvList([
          ['Банк', rec.bank || '—'],
          ['Сумма', money(rec.amount)],
          ['Ставка', percent(rec.rate)],
          ['Доход за год', money(yearly)],
          ['Доход в месяц', money(yearly / 12)],
          ['Окончание', rec.endsAt ? humanDate(rec.endsAt) : '—']
        ]));
      },
      footer(foot) {
        foot.appendChild(el('button', {
          class: 'btn btn--block', type: 'button', text: 'Изменить',
          onclick: () => { Sheet.close(); setTimeout(() => openDeposit(id), 90); }
        }));
      }
    });
  }

  /* ---------- Кредиты ---------- */

  const CREDIT_TYPES = ['Потребительский', 'Ипотека', 'Автокредит', 'Кредитная карта', 'Рассрочка'];

  function openCredit(id) {
    const rec = id ? Store.byId('credits', id) : null;
    const draft = {
      name: rec ? rec.name : '',
      type: rec ? rec.type : CREDIT_TYPES[0],
      bank: rec ? rec.bank : '',
      remaining: rec ? rec.remaining : 0,
      rate: rec ? rec.rate : 0,
      monthlyPayment: rec ? rec.monthlyPayment : 0
    };
    Sheet.open({
      title: rec ? 'Изменить кредит' : 'Новый кредит',
      build(body) {
        body.appendChild(field('Название', bind('c-name', draft, 'name', { placeholder: 'Например, ремонт' }, true), 'c-name'));

        const typeSel = el('select', { class: 'select', id: 'c-type' },
          CREDIT_TYPES.map(t => el('option', { value: t, text: t, selected: t === draft.type })));
        typeSel.addEventListener('change', () => { draft.type = typeSel.value; });
        body.appendChild(field('Тип кредита', typeSel, 'c-type'));

        body.appendChild(field('Банк', bind('c-bank', draft, 'bank', { placeholder: 'Название банка' }), 'c-bank'));
        body.appendChild(field('Остаток, ₽', bindAmount('c-rem', draft, 'remaining'), 'c-rem'));
        body.appendChild(el('div', { class: 'field' }, [
          el('div', { class: 'field-row' }, [
            el('div', {}, [
              el('label', { class: 'field-label', for: 'c-rate', text: 'Ставка, %' }),
              bindNumber('c-rate', draft, 'rate')
            ]),
            el('div', {}, [
              el('label', { class: 'field-label', for: 'c-pay', text: 'Платёж, ₽' }),
              bindNumber('c-pay', draft, 'monthlyPayment')
            ])
          ])
        ]));
      },
      footer(foot) {
        foot.appendChild(el('button', {
          class: 'btn btn--block', type: 'button', text: 'Сохранить',
          onclick: () => {
            if (!draft.name.trim()) { Toast.show('Укажите название кредита', { kind: 'err' }); return; }
            const payload = {
              name: draft.name.trim(), type: draft.type, bank: draft.bank.trim(),
              remaining: draft.remaining, rate: draft.rate, monthlyPayment: draft.monthlyPayment
            };
            if (rec) Store.patch('credits', rec.id, payload, payload.name);
            else Store.add('credits', payload, payload.name);
            Store.recordFinanceSnapshot();
            Sheet.close();
            Toast.show(rec ? 'Кредит обновлён' : 'Кредит добавлен');
          }
        }));
        if (rec) {
          foot.appendChild(el('button', {
            class: 'btn btn--ghost btn--block', type: 'button', text: 'Удалить кредит',
            style: 'margin-top:8px;color:var(--danger)',
            onclick: () => {
              Sheet.close();
              setTimeout(() => {
                Store.remove('credits', rec.id, rec.name);
                Store.recordFinanceSnapshot();
                Toast.show('Кредит в корзине', {
                  action: { label: 'Вернуть', run: () => Store.restore('credits', rec.id) }
                });
              }, 80);
            }
          }));
        }
      }
    });
  }

  function creditDetail(id) {
    const rec = Store.byId('credits', id);
    if (!rec) return;
    const i = Loan.rate(rec.rate);
    const n = Loan.months(rec.remaining, i, rec.monthlyPayment);
    const over = Loan.overpay(rec.remaining, i, rec.monthlyPayment);

    Sheet.open({
      title: rec.name,
      build(body) {
        body.appendChild(kvList([
          ['Тип', rec.type || '—'],
          ['Банк', rec.bank || '—'],
          ['Остаток', money(rec.remaining)],
          ['Ставка', percent(rec.rate)],
          ['Платёж в месяц', money(rec.monthlyPayment)],
          ['Осталось платить', monthsLabel(n)],
          ['Переплата до конца', isFinite(over) ? money(over) : 'платёж не покрывает проценты']
        ]));

      },
      footer(foot) {
        foot.appendChild(el('button', {
          class: 'btn btn--block', type: 'button', text: 'Изменить',
          onclick: () => { Sheet.close(); setTimeout(() => openCredit(id), 90); }
        }));
      }
    });
  }

  /* ---------- Отрисовка экрана ---------- */

  function render(opts) {
    const soft = opts && opts.soft;
    const safe = Store.state.safe;
    setText($('#safeName'), safe.name || 'Наличные дома');
    const applySafe = () => setText($('#safeAmount'), money(safe.amount));
    soft ? softSwap($('#safeAmount'), applySafe) : applySafe();

    /* Вклады */
    const deposits = Store.list('deposits');
    reconcile($('#depList'), deposits, depNodes, buildDeposit, paintDeposit);
    $('#depEmpty').hidden = deposits.length > 0;

    /* Кредиты */
    const credits = Store.list('credits');
    reconcile($('#creditList'), credits, credNodes, buildCredit, paintCredit);
    $('#creditEmpty').hidden = credits.length > 0;
    renderAudit(soft);
  }

  function renderAudit(soft) {
    const key = View.key || keyOf(new Date().toISOString());
    const currentEnd = new Date(yearOf(key), monOf(key) + 1, 0, 23, 59, 59, 999).getTime();
    const previousKey = shiftKey(key, -1);
    const previousEnd = new Date(yearOf(previousKey), monOf(previousKey) + 1, 0, 23, 59, 59, 999).getTime();
    const snapshots = (Store.state.financeSnapshots || []).slice().sort((a, b) => a.at - b.at);
    const current = snapshots.filter(s => s.at <= currentEnd).pop();
    const previous = snapshots.filter(s => s.at <= previousEnd).pop();
    const baseline = previous;
    const period = () => setText($('#finAuditPeriod'), previous ? previousKey.replace('-', ' / ') : 'нет данных');
    period();
    const paint = (id, value, kind) => {
      const node = $('#' + id);
      const apply = () => {
        const isNewMetric = current && baseline && baseline[kind] === 0 && current[kind] > 0;
        const favorable = kind === 'payments' || kind === 'credits' ? value < 0 : value > 0;
        const tone = value === 0 ? 'is-flat' : favorable ? 'is-good' : 'is-bad';
        node.className = 'fade-swap fin-audit-value ' + tone;
        // Первое появление вклада/кредита не является ухудшением:
        // раньше такой позиции просто не было в учёте.
        node.textContent = current && baseline && !isNewMetric ? signedMoney(value) : '—';
      };
      soft ? softSwap(node, apply) : apply();
    };
    paint('finAuditSafe', current && baseline ? current.safe - baseline.safe : 0, 'safe');
    paint('finAuditDeposits', current && baseline ? current.deposits - baseline.deposits : 0, 'deposits');
    paint('finAuditPayments', current && baseline ? current.payments - baseline.payments : 0, 'payments');
    paint('finAuditCredits', current && baseline ? current.credits - baseline.credits : 0, 'credits');
  }

  function signedMoney(value) {
    const n = Math.round(Number(value) || 0);
    if (!n) return '0 ₽';
    return (n > 0 ? '+' : '−') + money(Math.abs(n));
  }

  function reconcile(host, list, map, build, paint) {
    const seen = new Set();
    list.forEach((rec, index) => {
      seen.add(rec.id);
      let entry = map.get(rec.id);
      if (!entry) { entry = build(rec); map.set(rec.id, entry); }
      paint(entry, rec);
      const at = host.children[index];
      if (at !== entry.root) host.insertBefore(entry.root, at || null);
    });
    for (const [id, entry] of map) {
      if (seen.has(id)) continue;
      entry.root.remove();
      map.delete(id);
    }
  }

  function buildDeposit(rec) {
    const name = el('p', { class: 'fin-name' });
    const meta = el('p', { class: 'fin-meta' });
    const amount = el('p', { class: 'fin-amount' });
    const rate = el('span', { class: 'fin-rate' });
    const root = el('button', { class: 'fin-card', type: 'button' }, [
      el('span', { class: 'fin-icon fin-icon--dep' }, [icon('coins')]),
      el('span', { class: 'fin-body' }, [name, meta]),
      el('span', { class: 'fin-side' }, [
        el('span', {}, [amount, rate]),
        el('span', { class: 'fin-chev' }, [icon('right', 17)])
      ])
    ]);
    root.addEventListener('click', () => depositDetail(rec.id));
    return { root, name, meta, amount, rate };
  }

  function paintDeposit(entry, rec) {
    setText(entry.name, rec.name);
    setText(entry.meta, [rec.bank || 'Без банка', rec.endsAt ? 'до ' + humanDate(rec.endsAt) : 'бессрочный']
      .filter(Boolean).join(' · '));
    setText(entry.amount, money(rec.amount));
    setText(entry.rate, percent(rec.rate));
    entry.rate.title = percent(rec.rate) + ' годовых';
  }

  function buildCredit(rec) {
    const name = el('p', { class: 'fin-name' });
    const meta = el('p', { class: 'fin-meta' });
    const amount = el('p', { class: 'fin-amount' });
    const rate = el('span', { class: 'fin-rate' });
    const root = el('button', { class: 'fin-card fin-card--credit', type: 'button' }, [
      el('span', { class: 'fin-icon fin-icon--credit' }, [icon('bank')]),
      el('span', { class: 'fin-body' }, [name, meta]),
      el('span', { class: 'fin-side' }, [
        el('span', {}, [amount, rate]),
        el('span', { class: 'fin-chev' }, [icon('right', 17)])
      ])
    ]);
    root.addEventListener('click', () => creditDetail(rec.id));
    return { root, name, meta, amount, rate };
  }

  function paintCredit(entry, rec) {
    setText(entry.name, rec.name);
    setText(entry.meta, [rec.type, rec.bank, percent(rec.rate)].filter(Boolean).join(' · '));
    setText(entry.amount, money(rec.remaining));
    setText(entry.rate, money(rec.monthlyPayment) + '/мес');
    entry.rate.title = 'Ежемесячный платёж';
  }

  return { mount, render, creditDetail };
})();

/* ---------- Помощники форм ---------- */

function bind(id, draft, key, attrs, autofocus) {
  const placeholder = attrs && attrs.placeholder;
  const input = el('input', Object.assign({
    class: 'input', id: id, type: 'text', value: draft[key] || '', autocomplete: 'off'
  }, attrs || {}));
  if (autofocus) input.setAttribute('data-autofocus', '');
  input.addEventListener('focus', () => {
    if (input.value) input.select();
  }, { once: true });
  const syncPlaceholder = () => {
    if (placeholder) input.placeholder = input.value ? '' : placeholder;
  };
  input.addEventListener('input', () => { draft[key] = input.value; syncPlaceholder(); });
  input.addEventListener('change', () => { draft[key] = input.value; syncPlaceholder(); });
  syncPlaceholder();
  return input;
}

function bindAmount(id, draft, key) {
  const input = el('input', {
    class: 'input input--amount', id: id, type: 'text', inputmode: 'decimal',
    value: draft[key] ? nf0.format(draft[key]) : ''
  });
  input.addEventListener('input', () => {
    draft[key] = parseNum(input.value);
    const f = input.value.trim() === '' ? '' : nf0.format(draft[key]);
    if (f !== input.value) input.value = f;
  });
  return input;
}

function bindNumber(id, draft, key) {
  const input = el('input', {
    class: 'input', id: id, type: 'text', inputmode: 'decimal',
    value: draft[key] ? String(draft[key]).replace('.', ',') : ''
  });
  input.addEventListener('input', () => { draft[key] = parseNum(input.value); });
  return input;
}

function kvList(pairs) {
  const list = el('div', { class: 'list' });
  for (const [k, v] of pairs) {
    list.appendChild(el('div', { class: 'list-row list-row--static', style: 'grid-template-columns:1fr auto' }, [
      el('span', { class: 'list-label', text: k, style: 'font-weight:500;color:var(--text-2)' }),
      el('span', { class: 'list-side mono', text: String(v), style: 'color:var(--text);font-weight:600' })
    ]));
  }
  return list;
}
