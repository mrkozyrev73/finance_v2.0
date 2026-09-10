/* ============================================================
   Сборка приложения
   ============================================================ */

let rendering = false;
let renderPending = null;

const Render = {
  /**
   * Одна точка перерисовки. Внутри — обновление значений в уже
   * существующих узлах; DOM не пересоздаётся, прокрутка не двигается.
   * Повторные вызовы во время отрисовки схлопываются в один — так
   * подряд идущих перерисовок не бывает.
   */
  all(opts) {
    const o = opts || {};
    if (rendering) { renderPending = o; return; }
    rendering = true;
    try {
      // Сначала данные (материализация регулярных доходов), потом DOM
      ensureRecurring(View.key);
      MonthBar.render();
      Home.render(o);
      Stats.render(o);
      Fin.render(o);
      Settings.render();
      if (View.tab === 'stats') Stats.remeasure();
    } finally {
      rendering = false;
    }
    if (renderPending) {
      const next = renderPending;
      renderPending = null;
      Render.all(next);
    }
  }
};

function boot() {
  lockPortraitOrientation();
  initHaptics();
  Store.init();

  // Демонстрационный снимок для визуальной проверки финансовой аналитики.
  // Включается только адресом ?demoFinance=1 и не меняет сами финансовые записи.
  if (new URLSearchParams(location.search).get('demoFinance') === '1') {
    const demoKey = shiftKey(View.key, -1);
    const demoAt = new Date(yearOf(demoKey), monOf(demoKey) + 1, 0, 18, 0, 0, 0).getTime();
    Store.update(s => {
      if (!(s.safe && s.safe.amount) && !s.deposits.length && !s.credits.length) {
        s.safe = Object.assign({}, s.safe, { name: 'Резерв', amount: 50000, updatedAt: now() });
        s.deposits.push({ id: 'demo-deposit', createdAt: now(), updatedAt: now(), deletedAt: null,
          name: 'Накопительный', bank: 'Т-Банк', amount: 50000, rate: 6, endsAt: '' });
        s.credits.push({ id: 'demo-credit', createdAt: now(), updatedAt: now(), deletedAt: null,
          name: 'Ипотека', type: 'Ипотека', bank: 'Сбер', remaining: 4549549, rate: 4.5, monthlyPayment: 29000 });
      }
      s.financeSnapshots = (s.financeSnapshots || []).filter(r => r.id !== 'demo-finance-previous');
      s.financeSnapshots.push({
        id: 'demo-finance-previous', createdAt: demoAt, updatedAt: demoAt, deletedAt: null,
        at: demoAt, safe: 35000, deposits: 30000, credits: 4800000, payments: 35000
      });
    }, 'finance:demo');
  }

  Sheet.mount();
  Tabs.mount();
  MonthBar.mount();
  Home.mount();
  Stats.mount();
  Fin.mount();
  Settings.mount();

  // Первый месяц с данными — база, а не изменение.
  Store.ensureFinanceBaseline(View.key);

  // Восстанавливаем режим динамики и вкладку из настроек
  const s = Store.state.settings || {};
  if (s.dynMode === 'year') {
    View.dynMode = 'year';
    $$('#dynMode .seg').forEach(b =>
      setAttr(b, 'aria-selected', b.dataset.mode === 'year' ? 'true' : 'false'));
  }

  Render.all();
  // Фиксируем исходную точку; следующие ручные изменения попадут
  // в аудит уже с корректным месяцем.
  Store.recordFinanceSnapshot();

  if (s.lastTab && s.lastTab !== 'home') Tabs.select(s.lastTab);

  // Перерисовка при изменениях состояния (в том числе из другой вкладки)
  Store.subscribe((_state, reason) => {
    if (reason === 'remote' || reason === 'external') Render.all({ soft: true });
    else Render.all();
  });

  Sync.init();

  // Первый кадр отрисован — снимаем «замок» стартовой анимации
  document.documentElement.setAttribute('data-booted', '');
  registerServiceWorker();
}

function initHaptics() {
  document.addEventListener('pointerdown', (event) => {
    const control = event.target.closest('button, [role="tab"]');
    if (control && !control.disabled) haptic('light');
  }, { passive: true });
}

// В установленном PWA дополнительно просим браузер удерживать портретный режим.
// Манифест покрывает поддерживаемые платформы, а этот вызов помогает браузерам
// с Screen Orientation API и безопасно ничего не делает на iOS Safari.
function lockPortraitOrientation() {
  const orientation = screen.orientation;
  if (!orientation || typeof orientation.lock !== 'function') return;
  const lock = () => orientation.lock('portrait').catch(() => {});
  lock();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) lock();
  }, { passive: true });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;      // из файла SW не регистрируется
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js?v=2').catch(err => {
      console.info('[pwa] service worker не зарегистрирован:', err.message);
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
