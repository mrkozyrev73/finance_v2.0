/* ============================================================
   Утилиты: DOM, форматирование, даты
   ============================================================ */
'use strict';

const $  = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    }
  }
  if (children) {
    for (const c of [].concat(children)) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return node;
}

function icon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#ic-' + name);
  svg.appendChild(use);
  return svg;
}

const uid = () =>
  (Date.now().toString(36) + Math.random().toString(36).slice(2, 9)).toUpperCase();

const now = () => Date.now();

/* --- Числа и деньги --- */

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function money(v, opts) {
  const n = Number(v) || 0;
  const o = opts || {};
  const body = o.cents ? nf2.format(n) : nf0.format(Math.round(n));
  const sign = o.sign && n > 0 ? '+' : '';
  return sign + body + (o.bare ? '' : ' ₽');
}

/** Компактно: 128 400 → «128,4 тыс.», 2 400 000 → «2,4 млн» */
function moneyShort(v) {
  const n = Math.abs(Number(v) || 0);
  const s = n < 0 ? '-' : '';
  if (n >= 1e6) return s + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' млн';
  if (n >= 1e4) return s + Math.round(n / 1e3) + ' тыс.';
  if (n >= 1e3) return s + (n / 1e3).toFixed(1).replace('.', ',') + ' тыс.';
  return s + nf0.format(Math.round(n));
}

/** Для подписей на диаграммах — всегда одна строка: 307к, 1,9М */
function barShort(v) {
  const n = Math.abs(Number(v) || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',').replace(',0', '') + 'М';
  if (n >= 1e3) return Math.round(n / 1e3) + 'к';
  return nf0.format(Math.round(n));
}

function percent(v, digits) {
  const n = Number(v) || 0;
  return n.toFixed(digits === undefined ? 1 : digits).replace('.', ',') + '%';
}

function parseNum(str) {
  if (typeof str === 'number') return str;
  const cleaned = String(str || '')
    .replace(/\s| |₽/g, '')
    .replace(',', '.')
    .replace(/[^\d.\-]/g, '');
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

/* --- Даты --- */

const MONTHS_NOM = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const MONTHS_SHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
const MONTHS_DAT = ['январю','февралю','марту','апрелю','маю','июню','июлю','августу','сентябрю','октябрю','ноябрю','декабрю'];
const WEEKDAYS = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];

/** Ключ месяца: 2026-09 */
const mkey = (y, m) => y + '-' + String(m + 1).padStart(2, '0');
const keyOf = (iso) => String(iso || '').slice(0, 7);
const yearOf = (k) => parseInt(String(k).slice(0, 4), 10);
const monOf  = (k) => parseInt(String(k).slice(5, 7), 10) - 1;

function shiftKey(k, delta) {
  const d = new Date(yearOf(k), monOf(k) + delta, 1);
  return mkey(d.getFullYear(), d.getMonth());
}

function keyLabel(k) {
  return MONTHS_NOM[monOf(k)] + ' ' + yearOf(k);
}

function isoDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' +
         String(dt.getDate()).padStart(2, '0');
}

function humanDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return '';
  return d.getDate() + ' ' + MONTHS_GEN[d.getMonth()] + ' ' + d.getFullYear();
}

function humanTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return 'Сегодня, ' + time;
  return d.getDate() + ' ' + MONTHS_GEN[d.getMonth()] + ', ' + time;
}

/** Правильная форма слова: plural(3,'доход','дохода','доходов') */
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/* --- Разное --- */

function debounce(fn, ms) {
  let t = 0;
  const wrapped = function () {
    const args = arguments, self = this;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(self, args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = function () { clearTimeout(t); fn.apply(this, arguments); };
  return wrapped;
}

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Ненавязчивый тактильный отклик там, где браузер его поддерживает.
function haptic(kind) {
  if (!navigator.vibrate) return;
  const duration = kind === 'success' ? 10 : 6;
  try { navigator.vibrate(duration); } catch (_) {}
}

/** Апдейт текста без лишних перерисовок */
function setText(node, value) {
  if (!node) return;
  const v = String(value);
  if (node.textContent !== v) node.textContent = v;
}

function setAttr(node, name, value) {
  if (!node) return;
  if (value === null || value === false || value === undefined) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else {
    const v = value === true ? '' : String(value);
    if (node.getAttribute(name) !== v) node.setAttribute(name, v);
  }
}

/** Плавная замена содержимого без изменения геометрии */
const swapQueue = new WeakMap();
function softSwap(node, apply) {
  if (!node) return;
  if (prefersReducedMotion()) { apply(); return; }
  clearTimeout(swapQueue.get(node));
  node.setAttribute('data-dim', '');
  const t = setTimeout(() => {
    apply();
    node.removeAttribute('data-dim');
  }, 90);
  swapQueue.set(node, t);
}

/** Проекция инерции — экспоненциальное затухание (как в iOS) */
function projectMomentum(velocity, decelerationRate) {
  const d = decelerationRate === undefined ? 0.995 : decelerationRate;
  return (velocity / 1000) * d / (1 - d);
}

/** Резиновое сопротивление за границей */
function rubberband(overshoot, dimension, constant) {
  const c = constant === undefined ? 0.55 : constant;
  return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** Точка подключения синхронизации: хранилище дёргает её, ничего о ней не зная */
var SyncHook = { push: function () {} };
