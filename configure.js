#!/usr/bin/env node
/*
 * Вписывает адрес проекта Supabase прямо в готовый index.html.
 * После этого приложение не спрашивает URL — только логин и пароль.
 *
 *   node configure.js <URL проекта> <anon key> [файл]
 *
 * По умолчанию правится dist/index.html. Скрипт можно запускать
 * сколько угодно раз: он заменяет значения, а не дописывает.
 */

const fs = require('fs');
const path = require('path');

const [, , url, key, target] = process.argv;

if (!url || !key) {
  console.log('Использование: node configure.js <URL проекта> <anon key> [файл]');
  console.log('Оба значения — в Supabase: Project Settings → API.');
  process.exit(1);
}

if (!/^https:\/\/[^\s'"]+$/.test(url)) {
  console.error('URL должен начинаться с https:// и не содержать пробелов');
  process.exit(1);
}
if (key.length < 40) {
  console.error('Ключ выглядит слишком коротким — возьмите значение поля "anon public"');
  process.exit(1);
}

const file = path.resolve(target || path.join(__dirname, 'dist', 'index.html'));
if (!fs.existsSync(file)) {
  console.error('Файл не найден: ' + file);
  process.exit(1);
}

let html = fs.readFileSync(file, 'utf8');
const before = html;

html = html.replace(/const SUPABASE_URL = '[^']*';/, "const SUPABASE_URL = '" + url + "';");
html = html.replace(/const SUPABASE_ANON_KEY = '[^']*';/, "const SUPABASE_ANON_KEY = '" + key + "';");

if (html === before) {
  console.error('В файле не нашлись строки SUPABASE_URL / SUPABASE_ANON_KEY — это не тот index.html?');
  process.exit(1);
}

fs.writeFileSync(file, html);
console.log('Готово: ' + path.basename(file));
console.log('Проект: ' + url);
console.log('Теперь приложение спрашивает только логин и пароль.');
