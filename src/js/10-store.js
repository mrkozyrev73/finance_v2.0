/* ============================================================
   Слой данных
   Единый источник правды. Каждая запись несёт updatedAt и
   deletedAt — этого достаточно для слияния по «последний выиграл»
   и для корзины.
   ============================================================ */

const DB_KEY   = 'dohod.state.v1';
const CFG_KEY  = 'dohod.supabase.v1';
const SCHEMA   = 1;

/** Коллекции, которые синхронизируются как наборы записей */
const COLLECTIONS = [
  'incomes', 'categories', 'recurring', 'historical',
  'deposits', 'credits', 'notes', 'history', 'financeSnapshots'
];
/** Одиночные объекты — сливаются целиком по своему updatedAt */
const SINGLETONS = ['safe', 'settings'];

/* Палитра категорий: обход цветового круга в одном регистре насыщенности,
   чтобы соседние сектора кольца различались, а вместе читались как система. */
const DEFAULT_CATEGORIES = [
  { name: 'Обзор',                 color: '#18A46B' },
  { name: 'Статья на Дзен',        color: '#2E8B8B' },
  { name: 'Интеграция PRO АВТО',   color: '#4C7FA8' },
  { name: 'Продажа Авито',         color: '#6A6FB0' },
  { name: 'Продажа напрямую',      color: '#9B6BA8' },
  { name: 'Контракт',              color: '#B85E8E' },
  { name: 'Монетизация YouTube',   color: '#C0614C' },
  { name: 'Монетизация RuTube',    color: '#C3803F' },
  { name: 'Монетизация VK',        color: '#B39A3C' },
  { name: 'Участие в рейтинге',    color: '#8E9B45' },
  { name: 'Съёмка под заказ',      color: '#5E9C57' },
  { name: 'Кешбек сервисы',        color: '#7C8C85' },
  { name: 'Прочее',                color: '#9A8A7A' }
];

/** Версия стартового набора: подняли — значит при обновлении набор заменится */
const CATEGORIES_VERSION = 2;

/** Набор из первой версии — по нему узнаём категории «из коробки» */
const LEGACY_CATEGORY_NAMES = ['Зарплата', 'Фриланс', 'Аренда', 'Дивиденды', 'Продажи', 'Прочее'];

function stampNew(obj) {
  const t = now();
  return Object.assign({ id: uid(), createdAt: t, updatedAt: t, deletedAt: null }, obj);
}

function emptyState() {
  const s = {
    schema: SCHEMA,
    incomes: [],
    categories: DEFAULT_CATEGORIES.map((c, i) => stampNew({ name: c.name, color: c.color, order: i })),
    recurring: [],
    historical: [],
    deposits: [],
    credits: [],
    notes: [],
    history: [],
    financeSnapshots: [],
    safe:     { name: 'Наличные дома', amount: 0, updatedAt: now() },
    settings: {
      dynMode: 'month',
      statsKey: null,
      lastTab: 'home',
      categoriesVersion: CATEGORIES_VERSION,
      updatedAt: now()
    }
  };
  return s;
}

/* ------------------------------------------------------------
   Хранилище
   ------------------------------------------------------------ */

const Store = (() => {
  let state = emptyState();
  const listeners = new Set();
  let channel = null;
  let suppressBroadcast = false;

  function load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') state = migrate(parsed);
    } catch (e) {
      console.warn('[store] не удалось прочитать локальные данные', e);
    }
  }

  function migrate(data) {
    const base = emptyState();
    // Сохраняем только известные поля; неизвестные — игнорируем.
    for (const key of COLLECTIONS) {
      if (Array.isArray(data[key])) base[key] = data[key].filter(r => r && r.id);
    }
    for (const key of SINGLETONS) {
      if (data[key] && typeof data[key] === 'object') {
        base[key] = Object.assign({}, base[key], data[key]);
      }
    }
    const palette = new Map(DEFAULT_CATEGORIES.map(c => [c.name, c.color]));
    base.categories = base.categories.map(c => Object.assign({}, c, {
      color: c.color && c.color !== '#7C8C85' ? c.color : (palette.get(c.name) || c.color)
    }));
    for (const key of ['incomes', 'recurring']) {
      base[key] = base[key].map(r => Object.assign({}, r, {
        title: r.title || r.name || r.label || r.description || ''
      }));
    }
    if (!base.categories.length) base.categories = emptyState().categories;
    // Версию берём из пришедших данных, а не из подмешанных значений по умолчанию
    const storedVersion = (data.settings && data.settings.categoriesVersion) || 0;
    upgradeCategories(base, storedVersion);
    dedupeCategories(base);
    base.schema = SCHEMA;
    return base;
  }

  function categoryKey(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
  }

  /** Объединяет дубли, сохраняя привязки доходов и регулярных записей. */
  function dedupeCategories(target) {
    const live = (target.categories || [])
      .filter(c => c && !c.deletedAt)
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
    const keeperByName = new Map();
    const replacements = new Map();
    const stamp = now();

    for (const category of live) {
      const key = categoryKey(category.name);
      if (!key) continue;
      const keeper = keeperByName.get(key);
      if (!keeper) {
        keeperByName.set(key, category);
        continue;
      }
      replacements.set(category.id, keeper.id);
      category.deletedAt = stamp;
      category.updatedAt = stamp;
    }

    if (!replacements.size) return false;
    for (const listName of ['incomes', 'recurring']) {
      for (const record of target[listName] || []) {
        const replacement = replacements.get(record.categoryId);
        if (replacement) {
          record.categoryId = replacement;
          record.updatedAt = stamp;
        }
      }
    }
    return true;
  }

  /**
   * Обновление стартового набора категорий.
   *
   * Меняем только набор «из коробки» — тот, где все названия из первой
   * версии. Свои категории (переименованные, добавленные) не трогаем
   * никогда. Доходы, привязанные к старым категориям, не теряются:
   * они переезжают в «Прочее» нового набора.
   */
  function upgradeCategories(state, storedVersion) {
    const settings = state.settings || (state.settings = {});
    if (storedVersion >= CATEGORIES_VERSION) return;

    const live = (state.categories || []).filter(c => !c.deletedAt);
    const isStock = live.length > 0 && live.every(c => LEGACY_CATEGORY_NAMES.includes(c.name));
    const alreadyNew = live.length > 0 &&
      live.every(c => DEFAULT_CATEGORIES.some(d => d.name === c.name));

    if (alreadyNew || (!isStock && live.length)) {
      // Либо уже новый набор, либо пользователь настроил свой — только метим версию
      settings.categoriesVersion = CATEGORIES_VERSION;
      settings.updatedAt = now();
      return;
    }

    const oldIds = new Set(live.map(c => c.id));
    const t = now();
    for (const c of state.categories) {
      if (oldIds.has(c.id)) { c.deletedAt = t; c.updatedAt = t; }
    }
    const fresh = DEFAULT_CATEGORIES.map((c, i) => stampNew({ name: c.name, color: c.color, order: i }));
    state.categories.push(...fresh);

    // Ничего не осиротело: старые привязки уходят в «Прочее»
    const fallback = fresh[fresh.length - 1].id;
    for (const list of [state.incomes, state.recurring]) {
      for (const r of list || []) {
        if (oldIds.has(r.categoryId)) { r.categoryId = fallback; r.updatedAt = t; }
      }
    }

    settings.categoriesVersion = CATEGORIES_VERSION;
    settings.updatedAt = t;
  }

  const persist = debounce(() => {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('[store] запись не удалась', e);
      Toast.show('Не удалось сохранить локально — хранилище переполнено', { kind: 'err' });
    }
  }, 120);

  function emit(reason) {
    for (const fn of listeners) {
      try { fn(state, reason); } catch (e) { console.error(e); }
    }
  }

  function commit(reason) {
    persist();
    emit(reason || 'change');
    if (!suppressBroadcast && channel) {
      try { channel.postMessage({ type: 'state', at: now() }); } catch (_) {}
    }
    SyncHook.push();
  }

  /* --- Публичный API --- */

  const api = {
    get state() { return state; },

    init() {
      load();
      if ('BroadcastChannel' in window) {
        channel = new BroadcastChannel('dohod-sync');
        channel.onmessage = (ev) => {
          if (!ev.data || ev.data.type !== 'state') return;
          // Другая вкладка записала — перечитываем и перерисовываем.
          const before = JSON.stringify(state);
          load();
          if (JSON.stringify(state) !== before) emit('external');
        };
      }
      window.addEventListener('storage', (ev) => {
        if (ev.key !== DB_KEY) return;
        load();
        emit('external');
      });
    },

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Изменить состояние. mutator получает state; всё остальное — на нас. */
    update(mutator, reason) {
      suppressBroadcast = false;
      mutator(state);
      commit(reason);
    },

    /** Тихое применение (для входящей синхронизации) — без обратной отправки */
    applyRemote(next) {
      dedupeCategories(next);
      state = next;
      try { localStorage.setItem(DB_KEY, JSON.stringify(state)); } catch (_) {}
      emit('remote');
    },

    /* --- Работа с коллекциями --- */

    list(name) {
      return (state[name] || []).filter(r => !r.deletedAt);
    },

    byId(name, id) {
      return (state[name] || []).find(r => r.id === id) || null;
    },

    /** Первый месяц с финансовыми данными — стартовая точка аудита. */
    ensureFinanceBaseline(key) {
      if (state.settings && state.settings.financeBaselineKey) return;
      const safe = state.safe || {};
      const hasFinanceData = Number(safe.amount) > 0 || api.list('deposits').length > 0 || api.list('credits').length > 0;
      if (!hasFinanceData) return;
      api.update(s => {
        s.settings = Object.assign({}, s.settings, {
          financeBaselineKey: key,
          updatedAt: now()
        });
      }, 'finance:baseline');
    },

    /** Снимок финансов на момент ручного изменения — для помесячного аудита. */
    recordFinanceSnapshot() {
      const safe = state.safe || {};
      const deposits = api.list('deposits');
      const credits = api.list('credits');
      const snapshot = {
        at: now(),
        safe: Number(safe.amount) || 0,
        deposits: deposits.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
        credits: credits.reduce((sum, r) => sum + (Number(r.remaining) || 0), 0),
        payments: credits.reduce((sum, r) => sum + (Number(r.monthlyPayment) || 0), 0)
      };
      api.update(s => {
        const list = s.financeSnapshots || (s.financeSnapshots = []);
        const last = list[list.length - 1];
        if (last && ['safe', 'deposits', 'credits', 'payments'].every(k => last[k] === snapshot[k])) return;
        if (!s.settings.financeBaselineKey && (snapshot.safe > 0 || snapshot.deposits > 0 || snapshot.credits > 0 || snapshot.payments > 0)) {
          s.settings = Object.assign({}, s.settings, {
            financeBaselineKey: keyOf(new Date(snapshot.at)),
            updatedAt: now()
          });
        }
        list.push(stampNew(snapshot));
        if (list.length > 240) list.splice(0, list.length - 240);
      }, 'finance:snapshot');
    },

    add(name, data, logLabel) {
      const rec = stampNew(data);
      api.update(s => {
        s[name].push(rec);
        pushHistory(s, 'create', name, rec, logLabel);
      }, 'add:' + name);
      return rec;
    },

    patch(name, id, data, logLabel) {
      api.update(s => {
        const rec = s[name].find(r => r.id === id);
        if (!rec) return;
        // Даже два изменения в одну миллисекунду должны иметь устойчивый порядок.
        const updatedAt = Math.max(now(), (Number(rec.updatedAt) || 0) + 1);
        Object.assign(rec, data, { updatedAt });
        pushHistory(s, 'update', name, rec, logLabel);
      }, 'patch:' + name);
    },

    /** Мягкое удаление — запись попадает в корзину */
    remove(name, id, logLabel) {
      api.update(s => {
        const rec = s[name].find(r => r.id === id);
        if (!rec) return;
        rec.deletedAt = now();
        rec.updatedAt = now();
        pushHistory(s, 'delete', name, rec, logLabel);
      }, 'remove:' + name);
    },

    restore(name, id) {
      api.update(s => {
        const rec = s[name].find(r => r.id === id);
        if (!rec) return;
        rec.deletedAt = null;
        rec.updatedAt = now();
        pushHistory(s, 'restore', name, rec);
      }, 'restore:' + name);
    },

    purge(name, id) {
      api.update(s => {
        const i = s[name].findIndex(r => r.id === id);
        if (i >= 0) s[name].splice(i, 1);
      }, 'purge:' + name);
    },

    setSingleton(name, data) {
      api.update(s => {
        s[name] = Object.assign({}, s[name], data, { updatedAt: now() });
      }, 'set:' + name);
    },

    /** Все удалённые записи всех коллекций — для корзины */
    trash() {
      const out = [];
      for (const name of COLLECTIONS) {
        if (name === 'history') continue;
        for (const r of state[name] || []) {
          if (r.deletedAt) out.push({ collection: name, rec: r });
        }
      }
      return out.sort((a, b) => b.rec.deletedAt - a.rec.deletedAt);
    },

  };

  return api;
})();

/* ------------------------------------------------------------
   Журнал действий
   ------------------------------------------------------------ */

const HISTORY_LIMIT = 200;
const COLLECTION_LABELS = {
  incomes: 'Доход', categories: 'Категория',
  recurring: 'Регулярный доход', historical: 'Ранее заработанное',
  deposits: 'Вклад', credits: 'Кредит', notes: 'Заметка'
};
const ACTION_LABELS = {
  create: 'добавлен', update: 'изменён', delete: 'удалён', restore: 'восстановлен'
};

function pushHistory(s, action, collection, rec, label) {
  if (collection === 'history') return;
  const title = label || rec.title || rec.name || '';
  s.history.unshift({
    id: uid(),
    at: now(),
    action,
    collection,
    recId: rec.id,
    label: (COLLECTION_LABELS[collection] || collection) + ' ' + (ACTION_LABELS[action] || action),
    detail: title,
    amount: typeof rec.amount === 'number' ? rec.amount : null,
    updatedAt: now(),
    deletedAt: null
  });
  if (s.history.length > HISTORY_LIMIT) s.history.length = HISTORY_LIMIT;
}

/* ------------------------------------------------------------
   Слияние двух состояний (локальное + удалённое)
   Правило: по каждой записи побеждает большее updatedAt.
   Удаление — тоже запись с updatedAt, поэтому tombstone не теряется.
   ------------------------------------------------------------ */

function mergeStates(local, remote) {
  const out = emptyState();
  out.schema = SCHEMA;

  for (const name of COLLECTIONS) {
    const map = new Map();
    for (const rec of local[name] || []) if (rec && rec.id) map.set(rec.id, rec);
    for (const rec of remote[name] || []) {
      if (!rec || !rec.id) continue;
      const mine = map.get(rec.id);
      if (!mine) { map.set(rec.id, rec); continue; }
      const a = mine.updatedAt || 0, b = rec.updatedAt || 0;
      map.set(rec.id, b > a ? rec : mine);
    }
    out[name] = Array.from(map.values());
  }

  // История — объединение по id, ограничение по объёму
  out.history = out.history
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, HISTORY_LIMIT);

  for (const name of SINGLETONS) {
    const a = local[name] || {}, b = remote[name] || {};
    out[name] = (b.updatedAt || 0) > (a.updatedAt || 0)
      ? Object.assign({}, out[name], b)
      : Object.assign({}, out[name], a);
  }

  return out;
}

/* ------------------------------------------------------------
   Производные выборки
   ------------------------------------------------------------ */

const Data = {
  carriesToMonth(r, key) {
    return r.status === 'expected' && r.date && keyOf(r.date) < key;
  },
  categories() {
    return Store.list('categories').sort((a, b) =>
      Number(b.pinned) - Number(a.pinned) || (a.order || 0) - (b.order || 0));
  },
  /** Категории в порядке «недавно использованные — первыми» */
  recentCategories() {
    const all = Data.categories();
    const byId = new Map(all.map(c => [c.id, c]));
    const seen = [];
    const incomes = Store.list('incomes')
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    for (const r of incomes) {
      if (!byId.has(r.categoryId) || seen.includes(r.categoryId)) continue;
      seen.push(r.categoryId);
      if (seen.length >= all.length) break;
    }
    const pinned = all.filter(c => c.pinned);
    const head = seen.map(id => byId.get(id)).filter(c => !c.pinned);
    const tail = all.filter(c => !seen.includes(c.id));
    return pinned.concat(head, tail.filter(c => !c.pinned));
  },

  categoryMap() {
    const m = new Map();
    for (const c of Store.list('categories')) m.set(c.id, c);
    return m;
  },
  categoryName(id) {
    const c = Store.byId('categories', id);
    return c && !c.deletedAt ? c.name : 'Без категории';
  },
  categoryColor(id) {
    const c = Store.byId('categories', id);
    return (c && c.color) || '#A0A8A4';
  },
  /** Доходы месяца (ключ 2026-09) */
  incomesOf(key) {
    return Store.list('incomes')
      .filter(r => keyOf(r.date) === key || Data.carriesToMonth(r, key))
      // Статус меняется на месте: отметка «получен» не уводит строку
      // из-под пальца и не вызывает лишнюю перестановку списка.
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  /** Итоги месяца с учётом исторических сумм */
  totalsOf(key) {
    let received = 0, expected = 0;
    for (const r of Store.list('incomes')) {
      if (keyOf(r.date) !== key && !Data.carriesToMonth(r, key)) continue;
      if (r.status === 'received') received += r.amount || 0;
      else expected += r.amount || 0;
    }
    const hist = Store.list('historical')
      .filter(h => mkey(h.year, h.month) === key)
      .reduce((s, h) => s + (h.amount || 0), 0);
    received += hist;
    return { received, expected, total: received + expected, historical: hist };
  },

  /** Массив ключей месяцев назад от key, включая его */
  lastKeys(key, count) {
    const out = [];
    for (let i = count - 1; i >= 0; i--) out.push(shiftKey(key, -i));
    return out;
  },

  /** Все месяцы, где есть хоть какие-то данные */
  activeKeys() {
    const set = new Set();
    for (const r of Store.list('incomes')) if (r.date) set.add(keyOf(r.date));
    for (const h of Store.list('historical')) set.add(mkey(h.year, h.month));
    return Array.from(set).sort();
  },

  /** Разбивка по категориям за месяц или год */
  breakdown(scope) {
    const map = new Map();
    const add = (catId, amount, item) => {
      if (!map.has(catId)) map.set(catId, { catId, amount: 0, items: [] });
      const b = map.get(catId);
      b.amount += amount;
      if (item) b.items.push(item);
    };

    const matches = (k) => scope.type === 'year'
      ? yearOf(k) === scope.year
      : k === scope.key;

    for (const r of Store.list('incomes')) {
      if (!(matches(keyOf(r.date)) || (scope.type === 'month' && Data.carriesToMonth(r, scope.key)))) continue;
      add(r.categoryId || '__none', r.amount || 0, {
        id: r.id,
        title: r.title || 'Без названия',
        status: r.status,
        amount: r.amount || 0,
        monthKey: scope.type === 'month' ? scope.key : keyOf(r.date)
      });
    }
    for (const h of Store.list('historical')) {
      const k = mkey(h.year, h.month);
      if (!matches(k)) continue;
      add('__historical', h.amount || 0, {
        id: h.id,
        title: 'Ранее заработанное',
        status: 'received',
        amount: h.amount || 0,
        monthKey: k
      });
    }

    const rows = Array.from(map.values()).sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    for (const r of rows) {
      r.name  = r.catId === '__historical' ? 'Ранее заработанное'
              : r.catId === '__none' ? 'Без категории'
              : Data.categoryName(r.catId);
      r.color = r.catId === '__historical' ? '#7C8C85'
              : r.catId === '__none' ? '#C3CBC7'
              : Data.categoryColor(r.catId);
      r.share = total > 0 ? (r.amount / total) * 100 : 0;
      r.items.sort((a, b) => b.amount - a.amount);
    }
    return { rows, total };
  }
};
