/* ============================================================
   Настройки
   ============================================================ */

const Settings = (() => {
  const ACCENT_KEY = 'dohod.accent-theme.v1';
  const accentThemes = [
    { id: 'green', name: 'Зелёный', color: '#199B66' },
    { id: 'blue', name: 'Синий', color: '#3478C6' },
    { id: 'violet', name: 'Фиолетовый', color: '#8057C5' },
    { id: 'terracotta', name: 'Терракотовый', color: '#C0614C' },
    { id: 'graphite', name: 'Графитовый', color: '#56636D' }
  ];

  function currentAccent() {
    return accentThemes.find(theme => theme.id === document.documentElement.dataset.accentTheme) || accentThemes[0];
  }

  function applyAccent(id, persist = true) {
    const theme = accentThemes.find(item => item.id === id) || accentThemes[0];
    document.documentElement.dataset.accentTheme = theme.id;
    if (persist) try { localStorage.setItem(ACCENT_KEY, theme.id); } catch (_) {}
    setText($('#accentThemeName'), theme.name);
    const swatch = $('#accentThemeSwatch');
    if (swatch) swatch.style.backgroundColor = theme.color;
    return theme;
  }

  function mount() {
    $$('#scr-set [data-open]').forEach(btn => {
      btn.addEventListener('click', () => openScreen(btn.dataset.open));
    });
    $('#syncOpen').addEventListener('click', () => Sync.openSheet());
    applyAccent(currentAccent().id);
    window.addEventListener('storage', event => {
      if (event.key === ACCENT_KEY) applyAccent(event.newValue || 'green', false);
    });
    const authBtn = $('#syncAuth');
    authBtn.addEventListener('click', (e) => { e.stopPropagation(); Sync.toggleAuth(); });
    authBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); Sync.toggleAuth(); }
    });
  }

  function openScreen(name) {
    switch (name) {
      case 'categories': return openCategories();
      case 'wishlistPeople': return openWishlistPeople();
      case 'accentTheme': return openAccentTheme();
      case 'recurring':  return openRecurring();
      case 'history':    return openHistory();
      case 'trash':      return openTrash();
      case 'historical': return openHistorical();
      case 'sync':       return Sync.openSheet();
    }
  }

  function openAccentTheme() {
    Sheet.open({
      title: 'Цвет акцента',
      build(body) {
        body.appendChild(el('p', { class: 'section-sub accent-theme-hint', text: 'Тема сохранится только на этом устройстве.' }));
        const list = el('div', { class: 'accent-theme-list', role: 'group', 'aria-label': 'Варианты цвета акцента' });
        const buttons = [];
        const sync = selected => buttons.forEach((button, index) => setAttr(button, 'aria-pressed', accentThemes[index].id === selected ? 'true' : 'false'));
        accentThemes.forEach(theme => {
          const button = el('button', {
            class: 'accent-theme-option', type: 'button', 'aria-pressed': currentAccent().id === theme.id ? 'true' : 'false',
            onclick: () => { applyAccent(theme.id); sync(theme.id); }
          }, [
            el('i', { class: 'accent-theme-dot', style: 'background:' + theme.color, 'aria-hidden': 'true' }),
            el('span', { class: 'accent-theme-label', text: theme.name }),
            el('span', { class: 'accent-theme-check', 'aria-hidden': 'true' }, [icon('check')])
          ]);
          buttons.push(button);
          list.appendChild(button);
        });
        body.appendChild(list);
      }
    });
  }

  function openWishlistPeople() {
    const draft = (Store.state.settings.wishlistPeople || []).map(name => String(name || '').trim()).filter(Boolean).slice(0, 2);
    Sheet.open({
      title: 'Имена вишлиста',
      build(body) {
        body.appendChild(el('p', { class: 'section-sub wishlist-people-hint', text: 'Эти имена будут доступны при добавлении желания.' }));
        const host = el('div', { class: 'list wishlist-name-list' });
        const paint = () => {
          host.replaceChildren();
          draft.forEach((name, index) => {
            const input = el('input', { class: 'input', value: name, maxlength: '32', placeholder: 'Например, Антон', 'aria-label': 'Имя ' + (index + 1) });
            input.addEventListener('input', () => { draft[index] = input.value; });
            const remove = el('button', { class: 'icon-del', type: 'button', 'aria-label': 'Убрать имя ' + name, onclick: () => { draft.splice(index, 1); paint(); } }, [icon('close')]);
            host.appendChild(el('div', { class: 'edit-row wishlist-name-row' }, [input, remove]));
          });
          add.hidden = draft.length >= 2;
        };
        const add = el('button', { class: 'btn-dashed wishlist-name-add', type: 'button', onclick: () => { if (draft.length >= 2) return; draft.push(''); paint(); const input = $('input', host.lastElementChild); if (input) input.focus(); } }, [icon('plus'), el('span', { text: 'Добавить имя' })]);
        body.append(host, add);
        paint();
      },
      footer(foot) {
        foot.appendChild(el('button', { class: 'btn btn--block', type: 'button', text: 'Сохранить имена', onclick: () => {
          const clean = draft.map(name => name.trim()).filter(Boolean).slice(0, 2);
          if (new Set(clean.map(name => name.toLocaleLowerCase('ru-RU'))).size !== clean.length) {
            Toast.show('Имена не должны повторяться', { kind: 'err' });
            return;
          }
          Store.setSingleton('settings', { wishlistPeople: clean });
          Sheet.close();
          Toast.show('Имена вишлиста сохранены');
        } }));
      }
    });
  }

  /* ---------- Категории и владельцы ---------- */

  function openCategories() {
    Sheet.open({
      title: 'Категории доходов',
      build(body) {
        const catList = el('div', { class: 'list' });

        const paint = () => {
          catList.innerHTML = '';
          for (const c of Data.categories()) catList.appendChild(catRow(c, paint));
          if (!Data.categories().length) {
            catList.appendChild(el('div', { class: 'edit-row' }, [
              el('span', { class: 'list-note', text: 'Категорий нет' })
            ]));
          }
        };

        body.appendChild(catList);
        body.appendChild(el('button', {
          class: 'btn-dashed', type: 'button', style: 'margin-top:10px',
          onclick: () => {
            const rec = Store.add('categories', {
              name: 'Новая категория',
              color: pickColor(),
              order: Data.categories().length
            });
            paint();
            setTimeout(() => {
              const input = $('[data-cat="' + rec.id + '"]', catList);
              if (input) { input.focus(); input.select(); }
            }, 40);
          }
        }, [icon('plus'), el('span', { text: 'Добавить категорию' })]));

        paint();
      },
      footer(foot) {
        foot.appendChild(el('button', {
          class: 'btn btn--block', type: 'button', text: 'Готово',
          onclick: () => { Sheet.close(); Toast.show('Изменения сохранены'); }
        }));
        foot.appendChild(el('button', {
          class: 'btn btn--ghost btn--block', type: 'button',
          text: 'Вернуть набор по умолчанию',
          style: 'margin-top:8px',
          onclick: () => confirmSheet({
            title: 'Вернуть набор по умолчанию?',
            text: 'Текущие категории уедут в корзину, вместо них встанет стандартный список. ' +
                  'Уже внесённые доходы останутся, но привязку к категории придётся выставить заново.',
            confirmLabel: 'Вернуть',
            onConfirm: () => { resetCategories(); setTimeout(openCategories, 80); }
          })
        }));
      }
    });
  }

  /** Полная замена списка категорий на стандартный */
  function resetCategories() {
    Store.update(s => {
      const t = now();
      for (const c of s.categories) {
        if (!c.deletedAt) { c.deletedAt = t; c.updatedAt = t; }
      }
      DEFAULT_CATEGORIES.forEach((c, i) => {
        s.categories.push(stampNew({ name: c.name, color: c.color, order: i }));
      });
    }, 'categories-reset');
    Toast.show('Категории заменены на стандартные');
  }

  const PALETTE = DEFAULT_CATEGORIES.map(c => c.color);
  const NEW_CATEGORY_COLORS = PALETTE.filter(color =>
    color !== '#7C8C85' && color !== '#9A8A7A');
  function pickColor() {
    const used = Data.categories().map(c => c.color);
    const available = NEW_CATEGORY_COLORS.filter(c => !used.includes(c));
    const pool = available.length ? available : NEW_CATEGORY_COLORS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function catRow(rec, refresh) {
    const swatch = el('button', {
      class: 'cat-swatch', type: 'button',
      'aria-label': 'Цвет категории',
      style: 'width:22px;height:22px;border:0;border-radius:7px;cursor:pointer;background:' + rec.color
    });
    swatch.addEventListener('click', () => {
      const next = PALETTE[(PALETTE.indexOf(rec.color) + 1) % PALETTE.length];
      Store.patch('categories', rec.id, { color: next }, rec.name);
      swatch.style.background = next;
    });

    const input = el('input', { value: rec.name, 'aria-label': 'Название категории' });
    input.dataset.cat = rec.id;
    const save = debounce(() => {
      const v = input.value.trim();
      if (v && v !== rec.name) Store.patch('categories', rec.id, { name: v }, v);
    }, 350);
    input.addEventListener('input', save);
    input.addEventListener('blur', () => save.flush());

    const del = el('button', { class: 'icon-del', type: 'button', 'aria-label': 'Удалить категорию' }, [icon('trash')]);
    del.addEventListener('click', () => {
      const used = Store.list('incomes').filter(r => r.categoryId === rec.id).length;
      confirmSheet({
        title: 'Удалить категорию?',
        text: used
          ? 'В категории «' + rec.name + '» ' + used + ' ' + plural(used, 'доход', 'дохода', 'доходов') +
            '. Они останутся, но будут показаны как «Без категории».'
          : 'Категория «' + rec.name + '» переедет в корзину.',
        danger: true,
        confirmLabel: 'Удалить',
        onConfirm: () => {
          Store.remove('categories', rec.id, rec.name);
          setTimeout(() => { openCategories(); }, 60);
        }
      });
    });

    const pin = el('button', {
      class: 'category-pin' + (rec.pinned ? ' is-pinned' : ''),
      type: 'button',
      'aria-label': rec.pinned ? 'Открепить категорию' : 'Закрепить категорию',
      'aria-pressed': rec.pinned ? 'true' : 'false',
      text: rec.pinned ? '★' : '☆'
    });
    pin.addEventListener('click', () => {
      Store.patch('categories', rec.id, { pinned: !rec.pinned }, rec.name);
      refresh();
    });

    return el('div', { class: 'edit-row', style: 'grid-template-columns:22px 1fr auto auto;gap:8px' },
      [swatch, input, pin, del]);
  }


  /* ---------- Регулярные доходы ---------- */

  function openRecurring() {
    Sheet.open({
      title: 'Регулярные доходы',
      build(body) {
        const list = Store.list('recurring');
        if (!list.length) {
          body.appendChild(el('div', { class: 'empty', text: 'Регулярных доходов нет. Отметьте «Повторять каждый месяц» при добавлении дохода.' }));
          return;
        }
        const host = el('div', { class: 'list' });
        for (const rec of list) {
          host.appendChild(el('div', { class: 'list-row list-row--static' }, [
            el('span', { class: 'list-ico' }, [icon('repeat')]),
            el('span', {}, [
              el('span', { class: 'list-label', text: rec.title }),
              el('span', {
                class: 'list-note',
                text: money(rec.amount) + ' · ' + Data.categoryName(rec.categoryId) +
                      ' · ' + rec.day + ' числа'
              })
            ]),
            el('button', {
              class: 'icon-del', type: 'button', 'aria-label': 'Отключить повтор',
              onclick: () => {
                Store.remove('recurring', rec.id, rec.title);
                Sheet.close();
                Toast.show('Повтор отключён. Уже созданные доходы остались.');
              }
            }, [icon('trash')])
          ]));
        }
        body.appendChild(host);
      }
    });
  }

  /* ---------- История действий ---------- */

  function openHistory() {
    Sheet.open({
      title: 'История действий',
      build(body) {
        const list = Store.list('history');
        if (!list.length) {
          body.appendChild(el('div', { class: 'empty', text: 'Пока ничего не происходило' }));
          return;
        }
        const host = el('div', { class: 'list' });
        for (const h of list.slice(0, 100)) {
          host.appendChild(el('div', { class: 'list-row list-row--static' }, [
            el('span', { class: 'list-ico' }, [icon(
              h.action === 'delete' ? 'trash' : h.action === 'create' ? 'plus' :
              h.action === 'restore' ? 'undo' : 'pencil')]),
            el('span', {}, [
              el('span', { class: 'list-label', text: h.label }),
              el('span', { class: 'list-note', text: [h.detail, humanTime(h.at)].filter(Boolean).join(' · ') })
            ]),
            h.amount ? el('span', { class: 'list-side mono', text: money(h.amount) }) : el('span')
          ]));
        }
        body.appendChild(host);
      },
      footer(foot) {
        foot.appendChild(el('button', {
          class: 'btn btn--ghost btn--block', type: 'button', text: 'Очистить журнал',
          onclick: () => confirmSheet({
            title: 'Очистить журнал?',
            text: 'Записи истории будут удалены. Сами доходы и финансы не изменятся.',
            danger: true, confirmLabel: 'Очистить',
            onConfirm: () => {
              Store.update(s => { s.history = []; }, 'history-clear');
              Toast.show('Журнал очищен');
            }
          })
        }));
      }
    });
  }

  /* ---------- Корзина ---------- */

  function openTrash() {
    Sheet.open({
      title: 'Корзина',
      build(body) {
        const items = Store.trash();
        if (!items.length) {
          body.appendChild(el('div', { class: 'empty', text: 'Корзина пуста' }));
          return;
        }
        const host = el('div', { class: 'list' });
        for (const { collection, rec } of items) {
          host.appendChild(el('div', { class: 'list-row list-row--static' }, [
            el('span', { class: 'list-ico' }, [icon('trash')]),
            el('span', {}, [
              el('span', { class: 'list-label', text: rec.title || rec.name || COLLECTION_LABELS[collection] || 'Запись' }),
              el('span', {
                class: 'list-note',
                text: (COLLECTION_LABELS[collection] || collection) + ' · ' + humanTime(rec.deletedAt)
              })
            ]),
            el('button', {
              class: 'sync-btn sync-btn--ghost', type: 'button', text: 'Вернуть',
              onclick: () => {
                Store.restore(collection, rec.id);
                Sheet.close();
                Toast.show('Запись восстановлена');
              }
            })
          ]));
        }
        body.appendChild(host);
      },
      footer(foot) {
        foot.appendChild(el('button', {
          class: 'btn btn--ghost btn--block', type: 'button', text: 'Очистить корзину',
          style: 'color:var(--danger)',
          onclick: () => confirmSheet({
            title: 'Очистить корзину?',
            text: 'Записи будут удалены безвозвратно на всех устройствах.',
            danger: true, confirmLabel: 'Удалить навсегда',
            onConfirm: () => {
              Store.update(s => {
                for (const name of COLLECTIONS) {
                  if (name === 'history') continue;
                  s[name] = s[name].filter(r => !r.deletedAt);
                }
              }, 'trash-purge');
              Toast.show('Корзина очищена');
            }
          })
        }));
      }
    });
  }

  /* ---------- Ранее заработанные доходы ---------- */

  const FIRST_YEAR = 2022;

  function openHistorical() {
    const nowY = new Date().getFullYear();
    const draft = { year: nowY, month: 0, amount: 0 };

    Sheet.open({
      title: 'Ранее заработанные доходы',
      build(body) {
        body.appendChild(el('p', {
          class: 'section-sub',
          text: 'Суммы за прошедшие месяцы. Они попадают в статистику и синхронизируются с аккаунтом.',
          style: 'margin:0 2px 14px'
        }));

        const years = [];
        for (let y = FIRST_YEAR; y <= nowY; y++) years.push(y);

        const yearSel = el('select', { class: 'select', id: 'h-year' },
          years.map(y => el('option', { value: y, text: String(y), selected: y === draft.year })));
        yearSel.addEventListener('change', () => { draft.year = parseInt(yearSel.value, 10); });

        const monthSel = el('select', { class: 'select', id: 'h-month' },
          MONTHS_NOM.map((m, i) => el('option', { value: i, text: m, selected: i === draft.month })));
        monthSel.addEventListener('change', () => { draft.month = parseInt(monthSel.value, 10); });

        body.appendChild(el('div', { class: 'field' }, [
          el('div', { class: 'field-row' }, [
            el('div', {}, [el('label', { class: 'field-label', for: 'h-year', text: 'Год' }), yearSel]),
            el('div', {}, [el('label', { class: 'field-label', for: 'h-month', text: 'Месяц' }), monthSel])
          ])
        ]));

        const amt = el('input', {
          class: 'input input--amount', id: 'h-amt', type: 'text',
          inputmode: 'decimal', placeholder: '0', 'data-autofocus': true
        });
        amt.addEventListener('input', () => {
          draft.amount = parseNum(amt.value);
          const f = amt.value.trim() === '' ? '' : nf0.format(draft.amount);
          if (f !== amt.value) amt.value = f;
        });
        body.appendChild(field('Сумма за месяц, ₽', amt, 'h-amt'));

        body.appendChild(el('button', {
          class: 'btn btn--block', type: 'button', text: 'Сохранить значение',
          style: 'margin-top:16px',
          onclick: () => {
            if (draft.amount <= 0) { Toast.show('Укажите сумму', { kind: 'err' }); return; }
            const existing = Store.list('historical')
              .find(h => h.year === draft.year && h.month === draft.month);
            const label = MONTHS_NOM[draft.month] + ' ' + draft.year;
            const saved = draft.amount;          // запоминаем до сброса поля
            if (existing) Store.patch('historical', existing.id, { amount: saved }, label);
            else Store.add('historical', { year: draft.year, month: draft.month, amount: saved }, label);
            amt.value = '';
            draft.amount = 0;
            paintList();
            Toast.show(label + ' — ' + money(saved) + (existing ? ' (обновлено)' : ''));
          }
        }));

        body.appendChild(el('p', { class: 'field-label', text: 'Уже добавлено', style: 'margin-top:22px' }));
        const listHost = el('div', { class: 'list' });
        body.appendChild(listHost);

        function paintList() {
          const items = Store.list('historical')
            .sort((a, b) => (b.year - a.year) || (b.month - a.month));
          listHost.innerHTML = '';
          if (!items.length) {
            listHost.appendChild(el('div', { class: 'edit-row' }, [
              el('span', { class: 'list-note', text: 'Значений пока нет' })
            ]));
            return;
          }
          for (const h of items) {
            listHost.appendChild(el('div', { class: 'list-row list-row--static' }, [
              el('span', { class: 'list-ico' }, [icon('calendar')]),
              el('span', {}, [
                el('span', { class: 'list-label', text: MONTHS_NOM[h.month] + ' ' + h.year }),
                el('span', { class: 'list-note', text: 'учитывается в статистике' })
              ]),
              el('span', { class: 'list-side', style: 'gap:4px' }, [
                el('span', { class: 'mono', style: 'color:var(--text);font-weight:600', text: money(h.amount) }),
                el('button', {
                  class: 'icon-del', type: 'button', 'aria-label': 'Удалить значение',
                  onclick: () => {
                    Store.remove('historical', h.id, MONTHS_NOM[h.month] + ' ' + h.year);
                    paintList();
                  }
                }, [icon('trash')])
              ])
            ]));
          }
        }

        paintList();
      }
    });
  }

  /* ---------- Отрисовка экрана ---------- */

  function render() {
    setText($('#badgeCats'), Data.categories().length);
    setText($('#badgeRec'), Store.list('recurring').length);
    setText($('#badgeHist'), Store.list('history').length);
    setText($('#badgeTrash'), Store.trash().length);
    setText($('#badgeHistorical'), Store.list('historical').length);
    setText($('#badgeWishPeople'), Math.min(2, (Store.state.settings.wishlistPeople || []).filter(Boolean).length));
    const theme = currentAccent();
    setText($('#accentThemeName'), theme.name);
    const swatch = $('#accentThemeSwatch');
    if (swatch) swatch.style.backgroundColor = theme.color;
    Sync.renderStatus();
  }

  return { mount, render, openHistorical, openWishlistPeople };
})();
