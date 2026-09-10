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
  const savingNodes = new Map();
  const credNodes = new Map();

  function mount() {
    $('#safeAdd').addEventListener('click', () => setTimeout(() => openSafe(null), 20));
    $('#depAdd').addEventListener('click', () => setTimeout(() => openDeposit(null), 20));
    $('#creditAdd').addEventListener('click', () => setTimeout(() => openCredit(null), 20));
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
          b.addEventListener('click', () => { Sheet.close(false, run); });
          list.appendChild(b);
        };
        add('Вклад', 'Название, банк, сумма, ставка', 'coins', () => openDeposit(null));
        add('Кредит', 'Остаток, ставка, ежемесячный платёж', 'bank', () => openCredit(null));
        body.appendChild(list);
      }
    });
  }


  /* ---------- Сейф ---------- */

  function openSafe(id) {
    const rec = id ? Store.byId('savings', id) : null;
    const draft = { name: rec ? rec.name : '', amount: rec ? rec.amount : 0 };
    Sheet.open({
      title: rec ? 'Изменить сбережение' : 'Новое сбережение',
      build(body) {
        const nameInput = el('input', { class: 'input', id: 's-name', value: draft.name, 'data-autofocus': true });
        nameInput.addEventListener('input', () => { draft.name = nameInput.value; });
        nameInput.addEventListener('focus', () => nameInput.select(), { once: true });
        body.appendChild(field('Название', nameInput, 's-name'));

        const amt = el('input', {
          class: 'input input--amount', id: 's-amt', type: 'text', inputmode: 'decimal',
          value: rec ? nf0.format(rec.amount || 0) : ''
        });
        amt.addEventListener('input', () => { draft.amount = parseNum(amt.value); });
        body.appendChild(field('Сумма, ₽', amt, 's-amt'));
      },
      footer(foot) {
        foot.appendChild(el('button', {
          class: 'btn btn--block', type: 'button', text: 'Сохранить',
          onclick: () => {
            const payload = { name: draft.name.trim() || 'Сбережения', amount: draft.amount };
            if (rec) Store.patch('savings', rec.id, payload, payload.name);
            else Store.add('savings', payload, payload.name);
            Store.recordFinanceSnapshot();
            Sheet.close();
            Toast.show(rec ? 'Сбережение обновлено' : 'Сбережение добавлено');
          }
        }));
        if (rec) {
          foot.appendChild(el('button', {
            class: 'btn btn--ghost btn--block', type: 'button', text: 'Зафиксировать как базу',
            onclick: () => { Store.rebaseFinance('savings', rec.id); Sheet.close(); Toast.show('База сбережения обновлена'); }
          }));
          foot.appendChild(el('button', {
            class: 'btn btn--ghost btn--block', type: 'button', text: 'Удалить сбережение',
            style: 'margin-top:8px;color:var(--danger)',
            onclick: () => {
              Sheet.close();
              setTimeout(() => {
                Store.remove('savings', rec.id, rec.name);
                Store.recordFinanceSnapshot();
                Toast.show('Сбережение в корзине', {
                  action: { label: 'Вернуть', run: () => Store.restore('savings', rec.id) }
                });
              }, 80);
            }
          }));
        }
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
            class: 'btn btn--ghost btn--block', type: 'button', text: 'Зафиксировать как базу',
            onclick: () => { Store.rebaseFinance('deposits', rec.id); Sheet.close(); Toast.show('База вклада обновлена'); }
          }));
        }
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
        const actions = el('div', { class: 'sheet-actions-inline' });
        actions.appendChild(el('button', {
          class: 'btn btn--ghost btn--block', type: 'button', text: 'Зафиксировать как базу',
          onclick: () => { Store.rebaseFinance('deposits', id); Sheet.close(); Toast.show('База вклада обновлена'); }
        }));
        actions.appendChild(el('button', {
          class: 'btn btn--block fin-detail-primary', type: 'button', text: 'Изменить',
          onclick: () => { Sheet.close(false, () => openDeposit(id)); }
        }));
        foot.appendChild(actions);
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
            class: 'btn btn--ghost btn--block', type: 'button', text: 'Зафиксировать как базу',
            onclick: () => { Store.rebaseFinance('credits', rec.id); Sheet.close(); Toast.show('База кредита обновлена'); }
          }));
        }
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
        const actions = el('div', { class: 'sheet-actions-inline' });
        actions.appendChild(el('button', {
          class: 'btn btn--ghost btn--block', type: 'button', text: 'Зафиксировать как базу',
          onclick: () => { Store.rebaseFinance('credits', id); Sheet.close(); Toast.show('База кредита обновлена'); }
        }));
        actions.appendChild(el('button', {
          class: 'btn btn--block fin-detail-primary', type: 'button', text: 'Изменить',
          onclick: () => { Sheet.close(false, () => openCredit(id)); }
        }));
        foot.appendChild(actions);
      }
    });
  }

  /* ---------- Отрисовка экрана ---------- */

  function render(opts) {
    const soft = opts && opts.soft;
    const savings = Store.list('savings');
    reconcile($('#safeList'), savings, savingNodes, buildSaving, paintSaving, soft);
    $('#safeEmpty').hidden = savings.length > 0;

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
    setText($('#finAuditPeriod'), 'общая история');
    const records = (name) => Store.state[name] || [];
    const delta = (record, field, baseField) => {
      if (!record || !record.baselineInitialized) return 0;
      return (Number(record[field]) || 0) - (Number(record[baseField]) || 0);
    };
    const sumDelta = (name, field, baseField) => records(name)
      .reduce((sum, record) => sum + delta(record, field, baseField), 0);
    const values = {
      safe: records('savings').reduce((sum, record) => sum + delta(record, 'amount', 'baselineAmount'), 0),
      deposits: sumDelta('deposits', 'amount', 'baselineAmount'),
      payments: records('credits').reduce((sum, record) => sum + delta(record, 'monthlyPayment', 'baselinePayment'), 0),
      credits: sumDelta('credits', 'remaining', 'baselineAmount')
    };
    const phrase = (kind, value) => {
      if (!value) return { label: 'Без изменений', amount: '' };
      const verbs = {
        safe: value > 0 ? 'Увеличился' : 'Уменьшился',
        deposits: value > 0 ? 'Стали больше' : 'Стали меньше',
        payments: value > 0 ? 'Увеличились' : 'Уменьшились',
        credits: value > 0 ? 'Увеличились' : 'Уменьшились'
      };
      return { label: verbs[kind] + ' на', amount: money(Math.abs(value)) };
    };
    const paint = (id, value, kind) => {
      const node = $('#' + id);
      const apply = () => {
        const favorable = kind === 'payments' || kind === 'credits' ? value < 0 : value > 0;
        const tone = value === 0 ? 'is-flat' : favorable ? 'is-good' : 'is-bad';
        node.className = 'fade-swap fin-audit-value ' + tone;
        const copy = phrase(kind, value);
        node.replaceChildren(...[
          el('span', { class: 'fin-audit-copy', text: copy.label }),
          copy.amount ? el('span', { class: 'fin-audit-number', text: copy.amount }) : null
        ].filter(Boolean));
      };
      soft ? softSwap(node, apply) : apply();
    };
    paint('finAuditSafe', values.safe, 'safe');
    paint('finAuditDeposits', values.deposits, 'deposits');
    paint('finAuditPayments', values.payments, 'payments');
    paint('finAuditCredits', values.credits, 'credits');
  }

  function signedMoney(value) {
    const n = Math.round(Number(value) || 0);
    if (!n) return '0 ₽';
    return (n > 0 ? '+' : '−') + money(Math.abs(n));
  }

  function reconcile(host, list, map, build, paint, soft) {
    const seen = new Set();
    list.forEach((rec, index) => {
      seen.add(rec.id);
      let entry = map.get(rec.id);
      if (!entry) { entry = build(rec); map.set(rec.id, entry); }
      paint(entry, rec, soft);
      const at = host.children[index];
      if (at !== entry.root) host.insertBefore(entry.root, at || null);
    });
    for (const [id, entry] of map) {
      if (seen.has(id)) continue;
      entry.root.remove();
      map.delete(id);
    }
  }

  function buildSaving(rec) {
    const name = el('p', { class: 'fin-name' });
    const meta = el('p', { class: 'fin-meta', text: 'Свободные средства' });
    const amount = el('p', { class: 'fin-amount fade-swap' });
    const card = el('button', { class: 'fin-card swipe-body', type: 'button' }, [
      el('span', { class: 'fin-icon fin-icon--safe' }, [icon('safe')]),
      el('span', { class: 'fin-body' }, [name, meta]),
      el('span', { class: 'fin-side' }, [
        el('span', {}, [amount]),
        el('span', { class: 'fin-chev' }, [icon('right', 17)])
      ])
    ]);
    card.addEventListener('click', () => openSafe(rec.id));
    const root = wrapFinanceCard(card, 'fin-saving-' + rec.id,
      () => openSafe(rec.id), () => removeSaving(rec.id), 'сбережение');
    return { root, name, amount };
  }

  function paintSaving(entry, rec, soft) {
    setText(entry.name, rec.name);
    const apply = () => setText(entry.amount, money(rec.amount));
    soft ? softSwap(entry.amount, apply) : apply();
  }

  function buildDeposit(rec) {
    const name = el('p', { class: 'fin-name' });
    const meta = el('p', { class: 'fin-meta' });
    const amount = el('p', { class: 'fin-amount' });
    const rate = el('span', { class: 'fin-rate' });
    const card = el('button', { class: 'fin-card swipe-body', type: 'button' }, [
      el('span', { class: 'fin-icon fin-icon--dep' }, [icon('coins')]),
      el('span', { class: 'fin-body' }, [name, meta]),
      el('span', { class: 'fin-side' }, [
        el('span', {}, [amount, rate]),
        el('span', { class: 'fin-chev' }, [icon('right', 17)])
      ])
    ]);
    card.addEventListener('click', () => depositDetail(rec.id));
    const root = wrapFinanceCard(card, 'fin-deposit-' + rec.id,
      () => openDeposit(rec.id), () => removeDeposit(rec.id), 'вклад');
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
    const card = el('button', { class: 'fin-card fin-card--credit swipe-body', type: 'button' }, [
      el('span', { class: 'fin-icon fin-icon--credit' }, [icon('bank')]),
      el('span', { class: 'fin-body' }, [name, meta]),
      el('span', { class: 'fin-side' }, [
        el('span', {}, [amount, rate]),
        el('span', { class: 'fin-chev' }, [icon('right', 17)])
      ])
    ]);
    // Сумма только отображается: быстрое изменение доступно отдельным
    // действием при свайпе вправо, чтобы случайный тап ничего не открывал.
    amount.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    // Все основные параметры видны на карточке, поэтому обычный тап
    // сразу открывает редактирование без промежуточного окна деталей.
    card.addEventListener('click', () => openCredit(rec.id));
    const root = wrapFinanceCard(card, 'fin-credit-' + rec.id,
      () => openCredit(rec.id), () => removeCredit(rec.id), 'кредит',
      () => openCreditAmount(rec.id));
    return { root, name, meta, amount, rate };
  }

  function paintCredit(entry, rec) {
    setText(entry.name, rec.name);
    setText(entry.meta, [rec.type, rec.bank, percent(rec.rate)].filter(Boolean).join(' · '));
    setText(entry.amount, money(rec.remaining));
    setText(entry.rate, money(rec.monthlyPayment) + '/мес');
    entry.rate.title = 'Ежемесячный платёж';
  }

  function openCreditAmount(id) {
    const rec = Store.byId('credits', id);
    if (!rec) return;
    const draft = { remaining: rec.remaining };
    Sheet.open({
      title: 'Остаток кредита',
      build(body) {
        body.appendChild(field('Новая сумма, ₽', bindAmount('c-quick-rem', draft, 'remaining'), 'c-quick-rem'));
        body.appendChild(el('p', { class: 'sheet-hint', text: 'Остальные параметры кредита останутся без изменений.' }));
      },
      footer(foot) {
        foot.appendChild(el('button', {
          class: 'btn btn--block', type: 'button', text: 'Сохранить сумму',
          onclick: () => {
            Store.patch('credits', rec.id, { remaining: draft.remaining }, rec.name);
            Store.recordFinanceSnapshot();
            Sheet.close();
            Toast.show('Остаток кредита обновлён');
          }
        }));
      }
    });
  }

  return { mount, render, creditDetail };
})();

function wrapFinanceCard(card, id, edit, remove, label, quick) {
  const leftActions = quick ? el('div', { class: 'swipe-actions swipe-actions--left' }, [
    el('button', {
      class: 'swipe-action swipe-action--quick', type: 'button',
      'aria-label': 'Изменить сумму ' + label,
      onclick: (e) => {
        e.stopPropagation();
        // Не открываем лист в тот же кадр, когда закрывается панель свайпа:
        // иначе на iPhone виден промежуточный белый кадр.
        Swipe.closeAll();
        setTimeout(quick, 220);
      }
    }, [icon('pencil'), el('span', { text: 'Сумма' })])
  ]) : null;
  const actions = el('div', { class: 'swipe-actions' }, [
    el('button', {
      class: 'swipe-action swipe-action--edit', type: 'button',
      'aria-label': 'Изменить ' + label,
      onclick: (e) => {
        e.stopPropagation();
        Swipe.closeAll();
        setTimeout(edit, 220);
      }
    }, [icon('pencil'), el('span', { text: 'Изменить' })]),
    el('button', {
      class: 'swipe-action swipe-action--del', type: 'button',
      'aria-label': 'Удалить ' + label,
      onclick: (e) => { e.stopPropagation(); Swipe.closeAll(); remove(); }
    }, [icon('trash'), el('span', { text: 'Удалить' })])
  ]);
  const row = el('div', { class: 'swipe fin-swipe' }, [leftActions, actions, card].filter(Boolean));
  Swipe.attach(row, card, id, { leftWidth: quick ? 68 : 0 });
  return row;
}

function removeDeposit(id) {
  const rec = Store.byId('deposits', id);
  if (!rec) return;
  Store.remove('deposits', id, rec.name);
  Store.recordFinanceSnapshot();
  Toast.show('Вклад в корзине', {
    action: { label: 'Вернуть', run: () => Store.restore('deposits', id) }
  });
}

function removeSaving(id) {
  const rec = Store.byId('savings', id);
  if (!rec) return;
  Store.remove('savings', id, rec.name);
  Store.recordFinanceSnapshot();
  Toast.show('Сбережение в корзине', {
    action: { label: 'Вернуть', run: () => Store.restore('savings', id) }
  });
}

function removeCredit(id) {
  const rec = Store.byId('credits', id);
  if (!rec) return;
  Store.remove('credits', id, rec.name);
  Store.recordFinanceSnapshot();
  Toast.show('Кредит в корзине', {
    action: { label: 'Вернуть', run: () => Store.restore('credits', id) }
  });
}

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
