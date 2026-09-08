/* ============================================================
   Синхронизация с Supabase

   Задача — «поменял на одном телефоне, через мгновение видно на
   втором». Поэтому:
   • отправка идёт сразу на первом изменении (без ожидания хвоста),
     а серия быстрых правок схлопывается в один запрос;
   • приём применяет данные прямо из realtime-события, без второго
     похода в базу;
   • при возврате приложения из фона делается догоняющий запрос:
     телефон спит — сокет умирает, и на это нельзя полагаться;
   • слияние позаписное (mergeStates), так что правки с двух
     устройств не затирают друг друга.

   Вход — логин и пароль. Supabase хранит учётку по адресу почты,
   поэтому логин без «@» дополняется техническим доменом.
   ============================================================ */

/* ------------------------------------------------------------------
   ПАРАМЕТРЫ ПРОЕКТА SUPABASE

   Впишите сюда один раз — и приложение перестанет спрашивать адрес:
   на всех устройствах останутся только логин и пароль.
   Значения берутся в Project Settings → API.

   Ключ anon публичный по своей природе: он в любом случае уходит
   в браузер, а доступ к данным ограничивают политики RLS. Держать
   его в файле не опаснее, чем вводить руками.
   ------------------------------------------------------------------ */
const SUPABASE_URL = 'https://citzcwjtczxrgbjgbdws.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ltaNA7nnVozoSCOcZIjg';

const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const LOGIN_DOMAIN = 'dohod.app';
const PUSH_WINDOW = 250;      // мс: минимальный интервал между отправками

const Sync = (() => {
  let cfg = { url: '', key: '' };
  let client = null;
  let session = null;
  let channel = null;
  let status = 'off';        // off | connecting | on | error | offline
  let detail = 'Только на этом устройстве';
  let lastSyncAt = 0;
  let pendingPush = false;
  let pushing = false;
  let pushTimer = 0;
  let lastPushAt = 0;
  let lastRemoteStamp = null;
  let householdId = localStorage.getItem('income-supabase-household-v1') || '';
  let revision = Number(localStorage.getItem('income-supabase-revision-v1') || 0);
  let pulledRemote = false;
  let libLoading = null;
  let builtIn = false;       // адрес зашит в файл — не спрашиваем его

  /* ---------- Конфигурация ---------- */

  function loadConfig() {
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      cfg = { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
      builtIn = true;
      return;
    }
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) cfg = Object.assign(cfg, JSON.parse(raw));
    } catch (_) {}
  }

  function saveConfig(next) {
    if (builtIn) return;
    cfg = Object.assign({}, cfg, next);
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (_) {}
  }

  const configured = () => !!(cfg.url && cfg.key);

  /** Логин → адрес для Supabase Auth */
  function toEmail(login) {
    const v = String(login || '').trim().toLowerCase();
    if (!v) return '';
    return v.includes('@') ? v : v.replace(/\s+/g, '') + '@' + LOGIN_DOMAIN;
  }
  /** Обратно — что показать в интерфейсе */
  function toLogin(email) {
    const v = String(email || '');
    return v.endsWith('@' + LOGIN_DOMAIN) ? v.slice(0, -(LOGIN_DOMAIN.length + 1)) : v;
  }

  /* ---------- Загрузка клиента ---------- */

  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    if (libLoading) return libLoading;
    libLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SUPABASE_CDN;
      s.async = true;
      s.onload = () => resolve(window.supabase);
      s.onerror = () => reject(new Error('Не удалось загрузить клиент Supabase'));
      document.head.appendChild(s);
    });
    return libLoading;
  }

  async function ensureClient() {
    if (client) return client;
    if (!configured()) return null;
    const lib = await loadLib();
    client = lib.createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'dohod.auth' },
      realtime: { params: { eventsPerSecond: 20 } }
    });
    client.auth.onAuthStateChange((_event, next) => {
      const had = !!session;
      session = next;
      if (session && !had) onSignedIn();
      if (!session && had) onSignedOut();
    });
    return client;
  }

  /* ---------- Статус ---------- */

  function setStatus(next, text) {
    status = next;
    if (text !== undefined) detail = text;
    renderStatus();
  }

  function agoLabel(ts) {
    if (!ts) return '';
    const sec = Math.round((Date.now() - ts) / 1000);
    if (sec < 5) return 'только что';
    if (sec < 60) return sec + ' ' + plural(sec, 'секунду', 'секунды', 'секунд') + ' назад';
    const min = Math.round(sec / 60);
    if (min < 60) return min + ' ' + plural(min, 'минуту', 'минуты', 'минут') + ' назад';
    return humanTime(ts).toLowerCase();
  }

  function renderStatus() {
    const led   = $('#syncLed');
    const title = $('#syncTitle');
    const sub   = $('#syncSub');
    const btn   = $('#syncAuth');
    const label = $('#syncAuthLabel');
    if (!led) return;

    const on = status === 'on';
    setAttr(led, 'data-on', on ? true : null);
    setAttr(led, 'data-err', status === 'error' ? true : null);
    setAttr(led, 'data-busy', status === 'connecting' ? true : null);

    setText(title, on ? 'Включена' : status === 'connecting' ? 'Подключение' : 'Выключена');

    let note = detail;
    if (on) {
      note = toLogin(session && session.user.email) +
        (lastSyncAt ? ' · обновлено ' + agoLabel(lastSyncAt) : '');
    }
    setText(sub, note);

    const signedIn = !!session;
    setText(label, signedIn ? 'Выйти' : configured() ? 'Войти' : 'Настроить');
    btn.className = 'sync-btn' + (signedIn ? ' sync-btn--ghost' : '');
    const ico = $('use', btn);
    if (ico) ico.setAttribute('href', signedIn ? '#ic-logout' : '#ic-login');
  }

  /* ---------- Жизненный цикл ---------- */

  async function init() {
    loadConfig();
    renderStatus();
    if (!configured()) return;
    setStatus('connecting', 'Подключение…');
    try {
      const c = await ensureClient();
      if (!c) return;
      const { data } = await c.auth.getSession();
      session = data.session || null;
      if (session) await onSignedIn();
      else setStatus('off', 'Войдите, чтобы включить');
    } catch (e) {
      console.warn('[sync]', e);
      setStatus('error', e.message || 'Не удалось подключиться');
    }
  }

  async function onSignedIn() {
    setStatus('connecting', 'Загружаем данные…');
    try {
      await pull();
      if (!pulledRemote) await push(true);
      subscribeRealtime();
      setStatus('on');
    } catch (e) {
      console.warn('[sync] вход', e);
      setStatus('error', e.message || 'Ошибка синхронизации');
    }
  }

  function onSignedOut() {
    unsubscribeRealtime();
    lastSyncAt = 0;
    setStatus('off', 'Только на этом устройстве');
  }

  /* ---------- Приём ---------- */

  /** Применить входящий документ поверх локального */
  function applyRemote(remote, stamp) {
    if (!remote || typeof remote !== 'object') return false;
    if (Array.isArray(remote.incomes)) {
      remote = Object.assign({}, remote, {
        incomes: remote.incomes.map((item, index) => Object.assign({}, item, {
          id: String(item.id || 'income-' + index),
          title: item.title || item.name || item.label || item.description || ''
        }))
      });
    }
    if (stamp) lastRemoteStamp = stamp;
    const merged = mergeStates(Store.state, remote);
    const before = JSON.stringify(Store.state);
    const after = JSON.stringify(merged);
    lastSyncAt = Date.now();
    if (before === after) { renderStatus(); return false; }
    Store.applyRemote(merged);
    Render.all({ soft: true });
    return true;
  }

  async function pull() {
    if (!client || !session) return null;
    const { data, error } = await client
      .from('app_state')
      .select('data, updated_at')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) { lastSyncAt = Date.now(); return null; }
    pulledRemote = true;
    const remote = normalizeLegacyPayload(data.data, data.updated_at);
    applyRemote(remote, data.updated_at);
    return remote;
  }

  function normalizeLegacyPayload(payload, updatedAt) {
    if (payload?.incomes || payload?.financeSnapshots) {
      const repaired = Object.assign({}, payload);
      const palette = new Map((typeof DEFAULT_CATEGORIES !== 'undefined' ? DEFAULT_CATEGORIES : []).map(item => [item.name, item.color]));
      repaired.categories = (payload.categories || []).map(item => Object.assign({}, item, {
        color: item.color && item.color !== '#7C8C85' ? item.color : (palette.get(item.name) || item.color || '#7C8C85')
      }));
      repaired.incomes = (payload.incomes || []).map((item, index) => Object.assign({}, item, {
        id: String(item.id || 'income-' + index),
        title: item.title || item.name || item.label || item.description || 'Доход'
      }));
      return repaired;
    }
    const remote = { schema: 1, incomes: [], categories: [], recurring: [], historical: [], deposits: [], credits: [], notes: [], history: [], financeSnapshots: [], safe: null, settings: {} };
    const categories = new Map();
    (payload?.categories || []).forEach((name, index) => {
      const label = typeof name === 'string' ? name : name.name;
      if (label) {
        const palette = typeof DEFAULT_CATEGORIES !== 'undefined' ? DEFAULT_CATEGORIES.find(item => item.name === label) : null;
        categories.set(label, { id: name.id || 'legacy-cat-' + index, name: label, color: name.color || palette?.color || '#7C8C85', order: index, updatedAt: updatedAt });
      }
    });
    (payload?.items || []).forEach((item, index) => {
      const category = item.category || 'Прочее';
      if (!categories.has(category)) {
        const palette = typeof DEFAULT_CATEGORIES !== 'undefined' ? DEFAULT_CATEGORIES.find(item => item.name === category) : null;
        categories.set(category, { id: 'legacy-cat-' + category, name: category, color: palette?.color || '#7C8C85', order: categories.size, updatedAt });
      }
      remote.incomes.push({ id: String(item.id || 'legacy-income-' + index), title: item.title || item.name || item.label || 'Доход', amount: Number(item.amount) || 0, categoryId: categories.get(category).id, status: item.status === 'received' ? 'received' : 'expected', date: item.date || null, month: item.month, createdAt: item.createdAt || item.updatedAt || updatedAt, updatedAt: item.updatedAt || updatedAt, deletedAt: null });
    });
    remote.categories = [...categories.values()];
    const finance = payload?.finance || {};
    remote.safe = { name: 'Наличные дома', amount: Number(finance.safe) || 0, updatedAt };
    (finance.credits || []).forEach((credit, index) => remote.credits.push({ id: String(credit.id || 'legacy-credit-' + index), name: credit.name || 'Кредит', remaining: Number(credit.debt) || 0, rate: Number(credit.rate) || 0, monthlyPayment: Number(credit.monthlyPayment) || 0, updatedAt, deletedAt: null }));
    return remote;
  }

  /* ---------- Отправка ---------- */

  /**
   * Первое изменение уходит немедленно, следующие в пределах окна
   * схлопываются в одну отправку. Ждать «на всякий случай» нечего:
   * на втором телефоне правка должна появиться сразу.
   */
  function schedulePush() {
    if (!client || !session) { pendingPush = true; return; }
    const since = Date.now() - lastPushAt;
    if (since >= PUSH_WINDOW && !pushing) { push(); return; }
    if (pushTimer) return;
    pushTimer = setTimeout(() => { pushTimer = 0; push(); }, Math.max(0, PUSH_WINDOW - since));
  }

  async function push(force) {
    clearTimeout(pushTimer); pushTimer = 0;
    if (!client || !session) { pendingPush = true; return; }
    if (pushing) { pendingPush = true; return; }
    if (!navigator.onLine) { pendingPush = true; setStatus('offline', 'Нет сети — изменения ждут отправки'); return; }

    pushing = true;
    lastPushAt = Date.now();
    try {
      const { data, error } = await client
        .from('app_state')
        .upsert({ user_id: session.user.id, data: Store.state, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
        .select('updated_at')
        .single();
      if (error) throw error;
      lastRemoteStamp = data.updated_at;
      lastSyncAt = Date.now();
      pendingPush = false;
      setStatus('on');
    } catch (e) {
      pendingPush = true;
      console.warn('[sync] отправка', e);
      setStatus('error', e.message || 'Не удалось отправить изменения');
    } finally {
      pushing = false;
      if (pendingPush && navigator.onLine && session && !force) schedulePush();
    }
  }

  /* ---------- Realtime ---------- */

  function subscribeRealtime() {
    if (!client || !session || channel) return;
    channel = client
      .channel('app_state:' + session.user.id)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'app_state',
        filter: 'user_id=eq.' + session.user.id
      }, (payload) => {
        const row = payload.new;
        if (!row || !row.updated_at) return;
        // Данные уже в событии — применяем сразу, без второго запроса
        if (row.updated_at === lastRemoteStamp) return;
        if (row.data && typeof row.data === 'object') applyRemote(normalizeLegacyPayload(row.data, row.updated_at), row.updated_at);
        else pull().catch(e => console.warn('[sync] realtime pull', e));
      })
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') setStatus('on');
        // Канал отвалился — пересоздаём и догоняем состояние
        if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
          if (!session) return;
          unsubscribeRealtime();
          setTimeout(() => {
            if (!session) return;
            subscribeRealtime();
            pull().catch(() => {});
          }, 1500);
        }
      });
  }

  function unsubscribeRealtime() {
    if (channel && client) { try { client.removeChannel(channel); } catch (_) {} }
    channel = null;
  }

  /* ---------- Догоняющая синхронизация ---------- */

  function catchUp(reason) {
    if (!client || !session) return;
    if (!navigator.onLine) return;
    setStatus('connecting', reason || 'Проверяем изменения…');
    pull()
      .then(() => { if (pendingPush) return push(); })
      .then(() => setStatus('on'))
      .catch(e => setStatus('error', e.message || 'Не удалось синхронизировать'));
  }

  document.addEventListener('visibilitychange', () => {
    // Экран телефона гас — вебсокет почти наверняка умер
    if (document.visibilityState === 'visible') catchUp();
  });
  window.addEventListener('focus', () => { if (session) catchUp(); });
  window.addEventListener('online', () => {
    if (!session) return;
    unsubscribeRealtime();
    subscribeRealtime();
    catchUp('Сеть вернулась, догоняем…');
  });
  window.addEventListener('offline', () => {
    if (session) setStatus('offline', 'Нет сети — изменения ждут отправки');
  });
  window.addEventListener('pagehide', () => {
    // Последний шанс дослать накопленное перед выгрузкой вкладки
    if (pendingPush && session) push(true);
  });

  /* ---------- Вход и выход ---------- */

  function toggleAuth() {
    if (session) {
      confirmSheet({
        title: 'Выйти из аккаунта?',
        text: 'Данные останутся на этом устройстве. Синхронизация остановится.',
        confirmLabel: 'Выйти',
        onConfirm: async () => {
          try { await client.auth.signOut(); } catch (_) {}
          session = null;
          onSignedOut();
          Toast.show('Вы вышли из аккаунта');
        }
      });
      return;
    }
    openSheet();
  }

  function translateAuthError(e) {
    const m = String(e && e.message || '');
    if (/Invalid login/i.test(m)) return 'Неверный логин или пароль. Первый раз — нажмите «Создать»';
    if (/already registered/i.test(m)) return 'Такой логин уже есть — войдите';
    if (/Password should be/i.test(m)) return 'Пароль короче шести символов';
    if (/Email address .* is invalid/i.test(m)) return 'Логин можно писать только латиницей';
    if (/confirm/i.test(m)) return 'В проекте включено подтверждение почты — отключите его в Authentication → Providers → Email';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Нет связи с проектом Supabase';
    return m || 'Не удалось выполнить вход';
  }

  /* ---------- Единый лист синхронизации ---------- */

  const SQL = `-- Выполните один раз в SQL Editor проекта Supabase
create table if not exists public.app_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

create policy "own row read"   on public.app_state
  for select using (auth.uid() = user_id);
create policy "own row insert" on public.app_state
  for insert with check (auth.uid() = user_id);
create policy "own row update" on public.app_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Нужно для мгновенного обмена между устройствами
alter table public.app_state replica identity full;
alter publication supabase_realtime add table public.app_state;`;

  function openSheet() {
    const draft = { login: '', password: '', url: cfg.url, key: cfg.key };

    Sheet.open({
      title: 'Синхронизация',
      build(body) {
        /* Состояние */
        const state = el('div', { class: 'sync-state-card' }, [
          el('span', { class: 'sync-led', 'data-on': status === 'on' ? '' : null }),
          el('span', {}, [
            el('span', { class: 'sync-title', text: status === 'on' ? 'Включена' : 'Выключена' }),
            el('span', {
              class: 'sync-sub',
              text: status === 'on'
                ? toLogin(session && session.user.email) + ' · обновлено ' + agoLabel(lastSyncAt)
                : detail
            })
          ])
        ]);
        body.appendChild(state);

        if (session) {
          body.appendChild(el('p', {
            class: 'section-sub',
            text: 'Откройте приложение с тем же логином на втором телефоне — изменения будут появляться сразу.',
            style: 'margin:14px 2px 0'
          }));
          body.appendChild(el('button', {
            class: 'btn-dashed', type: 'button', style: 'margin-top:14px',
            onclick: () => { catchUp('Обновляем…'); Toast.show('Проверяем изменения'); }
          }, [icon('cloud'), el('span', { text: 'Обновить сейчас' })]));
        } else if (configured()) {
          const login = el('input', {
            class: 'input', id: 'sy-login', type: 'text', autocapitalize: 'none',
            autocomplete: 'username', spellcheck: 'false',
            placeholder: 'например, anton', 'data-autofocus': true
          });
          login.addEventListener('input', () => { draft.login = login.value; });
          body.appendChild(field('Логин', login, 'sy-login'));

          const pass = el('input', {
            class: 'input', id: 'sy-pass', type: 'password',
            autocomplete: 'current-password', placeholder: 'минимум 6 символов'
          });
          pass.addEventListener('input', () => { draft.password = pass.value; });
          pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit('signin'); });
          body.appendChild(field('Пароль', pass, 'sy-pass'));

          body.appendChild(el('p', {
            class: 'section-sub',
            text: 'На первом телефоне — «Создать». На втором введите тот же логин и пароль и нажмите «Войти».',
            style: 'margin:12px 2px 0'
          }));
        } else {
          const url = el('input', {
            class: 'input', id: 'sy-url', type: 'url', value: draft.url,
            placeholder: 'https://xxxx.supabase.co', autocomplete: 'off',
            autocapitalize: 'none', spellcheck: 'false', 'data-autofocus': true
          });
          url.addEventListener('input', () => { draft.url = url.value.trim(); });
          body.appendChild(field('URL проекта', url, 'sy-url'));

          const key = el('textarea', {
            class: 'input', id: 'sy-key', placeholder: 'anon public key',
            autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false'
          });
          key.value = draft.key;
          key.addEventListener('input', () => { draft.key = key.value.trim(); });
          body.appendChild(field('Anon key', key, 'sy-key'));

          body.appendChild(el('p', {
            class: 'section-sub',
            text: 'Оба значения — в Project Settings → API. Ключ anon публичный: доступ к строкам ограничивают политики RLS.',
            style: 'margin:12px 2px 0'
          }));
        }

        /* Схема — всегда доступна, но свёрнута */
        const details = el('details', { class: 'disclose' });
        details.appendChild(el('summary', { text: 'Схема таблицы и параметры проекта' }));
        const inner = el('div', { class: 'disclose-body' });

        if (configured()) {
          inner.appendChild(el('p', {
            class: 'section-sub', style: 'margin:0 0 10px',
            text: 'Проект: ' + shortHost(cfg.url) + (builtIn ? ' (задан в файле)' : '')
          }));
        }

        inner.appendChild(el('pre', { class: 'code' }, [document.createTextNode(SQL)]));
        inner.appendChild(el('button', {
          class: 'btn-dashed', type: 'button', style: 'margin-top:10px',
          onclick: async () => {
            try { await navigator.clipboard.writeText(SQL); Toast.show('SQL скопирован'); }
            catch (_) { Toast.show('Скопируйте вручную', { kind: 'err' }); }
          }
        }, [icon('download'), el('span', { text: 'Скопировать SQL' })]));

        if (configured() && !builtIn) {
          inner.appendChild(el('button', {
            class: 'btn btn--ghost btn--block', type: 'button',
            text: 'Отключить проект', style: 'margin-top:10px;color:var(--danger)',
            onclick: async () => {
              try { if (client) await client.auth.signOut(); } catch (_) {}
              saveConfig({ url: '', key: '' });
              client = null; session = null; unsubscribeRealtime();
              setStatus('off', 'Только на этом устройстве');
              Sheet.close();
              Toast.show('Проект отключён');
            }
          }));
        }

        details.appendChild(inner);
        body.appendChild(details);
      },

      footer(foot) {
        if (session) {
          foot.appendChild(el('button', {
            class: 'btn btn--ghost btn--block', type: 'button', text: 'Выйти из аккаунта',
            onclick: () => { Sheet.close(); setTimeout(toggleAuth, 90); }
          }));
          return;
        }
        if (!configured()) {
          foot.appendChild(el('button', {
            class: 'btn btn--block', type: 'button', text: 'Подключить проект',
            onclick: async () => {
              if (!draft.url || !draft.key) { Toast.show('Заполните оба поля', { kind: 'err' }); return; }
              saveConfig({ url: draft.url, key: draft.key });
              client = null; session = null; unsubscribeRealtime();
              Sheet.close();
              await init();
              setTimeout(openSheet, 220);
            }
          }));
          return;
        }
        foot.appendChild(el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [
          el('button', {
            class: 'btn btn--ghost', type: 'button', id: 'sy-signup', text: 'Создать',
            onclick: () => submit('signup')
          }),
          el('button', {
            class: 'btn', type: 'button', id: 'sy-signin', text: 'Войти',
            onclick: () => submit('signin')
          })
        ]));
      }
    });

    async function submit(mode) {
      const email = toEmail(draft.login);
      if (!email || draft.password.length < 6) {
        Toast.show('Логин и пароль от шести символов', { kind: 'err' });
        return;
      }
      const btn = $('#sy-' + mode);
      const was = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; setText(btn, 'Подключаемся…'); }
      try {
        const c = await ensureClient();
        const fn = mode === 'signin' ? 'signInWithPassword' : 'signUp';
        const { data, error } = await c.auth[fn]({ email, password: draft.password });
        if (error) throw error;
        if (!data.session) {
          Sheet.close();
          Toast.show('В проекте включено подтверждение почты — отключите его в настройках Supabase', { kind: 'err' });
          return;
        }
        session = data.session;
        Sheet.close();
        await onSignedIn();
        Toast.show('Синхронизация включена');
      } catch (e) {
        console.warn('[sync] авторизация', e);
        Toast.show(translateAuthError(e), { kind: 'err' });
      } finally {
        if (btn) { btn.disabled = false; setText(btn, was); }
      }
    }
  }

  function shortHost(url) {
    try { return new URL(url).host; } catch (_) { return url; }
  }

  return {
    init, renderStatus, toggleAuth, openSheet,
    schedulePush,
    get isOn() { return status === 'on'; }
  };
})();

SyncHook.push = () => Sync.schedulePush();
