/* Демо-данные для проверки: три года истории, вклады, кредиты */
function buildSeed() {
  const t = Date.now();
  const uid = (() => { let n = 0; return () => 'SEED' + (++n).toString(36).toUpperCase(); })();
  const st = (o) => Object.assign({ id: uid(), createdAt: t, updatedAt: t, deletedAt: null }, o);

  const cats = [
    { name: 'Обзор',               color: '#18A46B' },
    { name: 'Статья на Дзен',      color: '#2E8B8B' },
    { name: 'Интеграция PRO АВТО', color: '#4C7FA8' },
    { name: 'Продажа Авито',       color: '#6A6FB0' },
    { name: 'Продажа напрямую',    color: '#9B6BA8' },
    { name: 'Контракт',            color: '#B85E8E' },
    { name: 'Монетизация YouTube', color: '#C0614C' },
    { name: 'Монетизация RuTube',  color: '#C3803F' },
    { name: 'Монетизация VK',      color: '#B39A3C' },
    { name: 'Участие в рейтинге',  color: '#8E9B45' },
    { name: 'Съёмка под заказ',    color: '#5E9C57' },
    { name: 'Кешбек сервисы',      color: '#7C8C85' },
    { name: 'Прочее',              color: '#9A8A7A' }
  ].map((c, i) => st({ name: c.name, color: c.color, order: i }));

  const incomes = [];
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');

  for (let back = 0; back < 14; back++) {
    const d = new Date(today.getFullYear(), today.getMonth() - back, 1);
    const key = d.getFullYear() + '-' + pad(d.getMonth() + 1);
    const future = back === 0;
    incomes.push(st({
      title: 'Обзор Camry 70', amount: 145000 + (back % 3) * 5000, status: 'received',
      categoryId: cats[0].id, date: key + '-05'
    }));
    incomes.push(st({
      title: 'Монетизация за месяц', amount: 60000,
      status: future ? 'expected' : 'received',
      categoryId: cats[6].id, date: key + '-20'
    }));
    incomes.push(st({
      title: 'Интеграция PRO АВТО', amount: 40000 + (back * 2500) % 30000,
      status: future ? 'expected' : 'received',
      categoryId: cats[2].id, date: key + '-14'
    }));
    incomes.push(st({
      title: 'Пригон Sonata', amount: 32000, status: 'received',
      categoryId: cats[4].id, date: key + '-01'
    }));
    if (back % 4 === 1) incomes.push(st({
      title: 'Статья про растаможку', amount: 21000, status: 'received',
      categoryId: cats[1].id, date: key + '-28'
    }));
    if (back === 0) incomes.push(st({
      title: 'Продажа Solaris', amount: 18500, status: 'expected',
      categoryId: cats[3].id, date: key + '-26'
    }));
  }

  const historical = [];
  for (let y = 2023; y <= 2024; y++) {
    for (let m = 0; m < 12; m++) {
      historical.push(st({ year: y, month: m, amount: 90000 + ((y + m) % 5) * 12000 }));
    }
  }

  return {
    schema: 1,
    incomes, categories: cats,
    recurring: [], historical,
    deposits: [
      st({ name: 'Накопительный', bank: 'Т-Банк', amount: 420000, rate: 16.5, endsAt: '2027-03-01' }),
      st({ name: 'Подушка',       bank: 'Сбер',   amount: 180000, rate: 13,   endsAt: '' })
    ],
    credits: [
      st({ name: 'Ипотека', type: 'Ипотека', bank: 'ВТБ', remaining: 3240000, rate: 8.4, monthlyPayment: 38500 }),
      st({ name: 'Ремонт',  type: 'Потребительский', bank: 'Альфа', remaining: 260000, rate: 19.9, monthlyPayment: 12400 })
    ],
    earlyPayments: [], notes: [], history: [],
    safe: { name: 'Наличные дома', amount: 85000, updatedAt: t },
    settings: { dynMode: 'month', lastTab: 'home', updatedAt: t }
  };
}
module.exports = { buildSeed };
