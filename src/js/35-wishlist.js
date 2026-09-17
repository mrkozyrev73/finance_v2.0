/* ============================================================
   Семейный вишлист
   ============================================================ */

const Wishlist = (() => {
  const nodes = new Map();
  const groups = new Map();
  const pending = new Map();
  let statusFilter = 'all';
  const desireLevels = [
    { value: 'fun', label: 'Просто нравится', color: '#6A6FB0' },
    { value: 'nice', label: 'Было бы здорово', color: '#C3803F' },
    { value: 'try', label: 'Хочу попробовать', color: '#2E8B8B' },
    { value: 'someday', label: 'Присматриваюсь', color: '#718179' },
    { value: 'strong', label: 'Очень хочется', color: '#C0614C' },
    { value: 'dream', label: 'Мечтаю об этом', color: '#A34D7A' },
    { value: 'want', label: 'Мечта-мечта', color: '#6268A9' }
  ];
  const normalizeDesire = value => value === 'useful' ? 'someday' : value === 'priority' ? 'dream' : value;

  const people = () => (Store.state.settings.wishlistPeople || [])
    .map(name => String(name || '').trim()).filter(Boolean).slice(0, 2);

  function mount() {
    $('#addWish').addEventListener('click', () => {
      if (!people().length) {
        Toast.show('Добавьте имена в Настройках → Имена вишлиста');
        return;
      }
      openForm(null);
    });
    $$('#wishFilters [data-filter]').forEach(button => button.addEventListener('click', () => {
      statusFilter = button.dataset.filter;
      $$('#wishFilters [data-filter]').forEach(item => setAttr(item, 'aria-pressed', item === button ? 'true' : 'false'));
      render();
    }));
  }

  function build(rec) {
    const dot = el('button', { class: 'status-dot', type: 'button', 'aria-pressed': 'false' }, [icon('check')]);
    dot.addEventListener('click', event => {
      event.stopPropagation();
      toggle(rec.id);
    });
    const title = el('p', { class: 'income-title' });
    const link = el('a', { class: 'wish-link', target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Открыть ссылку на подарок' }, [icon('external')]);
    link.addEventListener('click', event => {
      const urls = urlsFor(rec);
      if (urls.length < 2) return;
      event.preventDefault();
      openLinks(rec, urls);
    });
    const desire = el('span', { class: 'wish-desire', hidden: true });
    const amount = el('p', { class: 'income-amount' });
    const flag = el('span', { class: 'income-flag' });
    const body = el('div', { class: 'swipe-body wish-card', role: 'group' }, [
      el('article', { class: 'income wish-income' }, [
        dot,
        el('div', { class: 'income-main' }, [title, desire]),
        link,
        el('div', { class: 'income-side' }, [amount, flag])
      ])
    ]);
    const actions = el('div', { class: 'swipe-actions' }, [
      el('button', { class: 'swipe-action swipe-action--edit', type: 'button', 'aria-label': 'Изменить желание',
        onclick: event => { event.stopPropagation(); Swipe.closeAll(); setTimeout(() => openForm(rec.id), 220); }
      }, [icon('pencil'), el('span', { text: 'Изменить' })]),
      el('button', { class: 'swipe-action swipe-action--del', type: 'button', 'aria-label': 'Удалить желание',
        onclick: event => { event.stopPropagation(); Swipe.closeAll(); remove(rec.id); }
      }, [icon('trash'), el('span', { text: 'Удалить' })])
    ]);
    const row = el('div', { class: 'swipe wish-row' }, [actions, body]);
    row.dataset.wishId = rec.id;
    Swipe.attach(row, body, 'wish-' + rec.id);
    return { row, body, dot, title, link, desire, amount, flag };
  }

  function paint(entry, rec) {
    const gifted = rec.status === 'gifted';
    entry.dot.className = 'status-dot ' + (gifted ? 'status-dot--received' : 'status-dot--expected');
    setAttr(entry.dot, 'aria-pressed', gifted ? 'true' : 'false');
    setAttr(entry.dot, 'aria-label', gifted ? 'Вернуть в желания' : 'Отметить подаренным');
    setAttr(entry.dot, 'title', gifted ? 'Подарено — нажмите, чтобы вернуть' : 'Отметить подаренным');
    setText(entry.title, rec.title || 'Без названия');
    const urls = urlsFor(rec);
    const url = urls[0] || '';
    entry.link.hidden = !url;
    if (url) entry.link.href = url;
    setAttr(entry.link, 'aria-label', urls.length > 1 ? 'Открыть список ссылок на подарок' : 'Открыть ссылку на подарок');
    entry.link.title = urls.length > 1 ? 'Ссылки: ' + urls.length : 'Открыть ссылку';
    const level = desireLevels.find(item => item.value === normalizeDesire(rec.desireLevel));
    entry.desire.hidden = !level;
    entry.desire.className = 'wish-desire' + (level ? ' wish-desire--' + level.value : '');
    setText(entry.desire, level ? level.label : '');
    setText(entry.amount, rec.price > 0 ? money(rec.price) : '');
    entry.amount.hidden = !(rec.price > 0);
    entry.flag.hidden = false;
    entry.flag.className = 'income-flag' + (gifted ? '' : ' income-flag--expected');
    setText(entry.flag, gifted ? 'Подарено' : 'Хочу');
    entry.body.setAttribute('aria-label', [rec.title, level ? level.label : '', rec.price > 0 ? money(rec.price) : '', gifted ? 'Подарено' : 'Хочу'].filter(Boolean).join(' · '));
  }

  function toggle(id) {
    const active = pending.get(id);
    if (active) {
      clearTimeout(active.timer);
      pending.delete(id);
      const current = Store.byId('wishes', id);
      const entry = nodes.get(id);
      if (current && entry) paint(entry, current);
      if (entry) entry.row.removeAttribute('data-feedback');
      haptic('light');
      return;
    }
    const rec = Store.byId('wishes', id);
    const entry = nodes.get(id);
    if (!rec || !entry) return;
    const next = rec.status === 'gifted' ? 'wanted' : 'gifted';
    paint(entry, Object.assign({}, rec, { status: next }));
    entry.row.setAttribute('data-feedback', '');
    haptic(next === 'gifted' ? 'success' : 'light');
    const timer = setTimeout(() => {
      pending.delete(id);
      const current = Store.byId('wishes', id);
      if (!current) return;
      Store.patch('wishes', id, { status: next, statusChangedAt: now() }, current.title);
      Toast.show(next === 'gifted' ? 'Подарок подарен: «' + current.title + '»' : '«' + current.title + '» снова в желаниях');
    }, prefersReducedMotion() ? 0 : 650);
    pending.set(id, { timer });
  }

  function filtered() {
    return Store.list('wishes').filter(rec => {
      const activeStatus = pending.has(rec.id) ? (rec.status === 'gifted' ? 'wanted' : 'gifted') : rec.status;
      if (statusFilter === 'wanted' && activeStatus !== 'wanted') return false;
      if (statusFilter === 'gifted' && activeStatus !== 'gifted') return false;
      return true;
    }).sort((a, b) => {
      const aGifted = (pending.has(a.id) ? a.status !== 'gifted' : a.status === 'gifted');
      const bGifted = (pending.has(b.id) ? b.status !== 'gifted' : b.status === 'gifted');
      if (aGifted !== bGifted) return aGifted ? 1 : -1;
      return (b.statusChangedAt || b.updatedAt || b.createdAt || 0) - (a.statusChangedAt || a.updatedAt || a.createdAt || 0);
    });
  }

  function render() {
    const host = $('#wishList');
    if (!host) return;
    const names = people();
    $('#addWish').hidden = false;
    const all = Store.list('wishes');
    const wanted = all.filter(rec => pending.has(rec.id) ? rec.status === 'gifted' : rec.status !== 'gifted').length;
    const gifted = all.length - wanted;
    setText($('[data-count="all"]', $('#wishFilters')), all.length);
    setText($('[data-count="wanted"]', $('#wishFilters')), wanted);
    setText($('[data-count="gifted"]', $('#wishFilters')), gifted);
    const list = filtered();
    const before = prefersReducedMotion() ? null : new Map(
      Array.from(nodes, ([id, entry]) => [id, entry.row.getBoundingClientRect().top])
    );
    const seen = new Set();
    const grouped = new Map();
    const groupOrder = [...names];
    list.forEach(rec => {
      const owner = String(rec.person || '').trim() || 'Без имени';
      if (!groupOrder.includes(owner)) groupOrder.push(owner);
      if (!grouped.has(owner)) grouped.set(owner, []);
      grouped.get(owner).push(rec);
    });
    groupOrder.forEach(owner => {
      const records = grouped.get(owner);
      if (!records || !records.length) return;
      let group = groups.get(owner);
      if (!group) {
        const title = el('h3', { class: 'wish-group-title', text: owner });
        const rows = el('div', { class: 'row-gap wish-group-list' });
        const section = el('section', { class: 'wish-group', 'aria-label': owner }, [title, rows]);
        group = { section, rows };
        groups.set(owner, group);
      }
      host.appendChild(group.section);
      records.forEach((rec, index) => {
        seen.add(rec.id);
        let entry = nodes.get(rec.id);
        if (!entry) { entry = build(rec); nodes.set(rec.id, entry); }
        paint(entry, rec);
        const at = group.rows.children[index];
        if (at !== entry.row) group.rows.insertBefore(entry.row, at || null);
      });
    });
    for (const [owner, group] of groups) {
      if (grouped.has(owner)) continue;
      group.section.remove();
      groups.delete(owner);
    }
    for (const [id, entry] of nodes) {
      if (seen.has(id)) continue;
      entry.row.remove();
      nodes.delete(id);
    }
    if (before) requestAnimationFrame(() => {
      for (const [id, entry] of nodes) {
        const oldTop = before.get(id);
        if (oldTop === undefined) continue;
        const delta = oldTop - entry.row.getBoundingClientRect().top;
        if (Math.abs(delta) < 1) continue;
        entry.row.animate([
          { transform: 'translateY(' + delta + 'px)' },
          { transform: 'translateY(0)' }
        ], { duration: 240, easing: 'cubic-bezier(.23, 1, .32, 1)' });
      }
    });
    $('#wishEmpty').hidden = list.length > 0;
    setText($('#wishEmpty'), all.length === 0
      ? 'Пока желаний нет. Добавьте первое кнопкой выше.'
      : 'В этом фильтре пока нет желаний.');
  }

  function safeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (_) { return ''; }
  }

  function urlsFor(rec) {
    const source = Array.isArray(rec.urls) ? rec.urls : [rec.url];
    return [...new Set(source.map(safeUrl).filter(Boolean))];
  }

  function openLinks(rec, urls) {
    Sheet.open({
      title: 'Ссылки на подарок',
      build(body) {
        const list = el('div', { class: 'wish-link-list' });
        urls.forEach((url, index) => {
          let label = 'Ссылка ' + (index + 1);
          try { label = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
          list.appendChild(el('a', { class: 'btn btn--block wish-link-option', href: url, target: '_blank', rel: 'noopener noreferrer' }, [icon('external'), el('span', { text: label })]));
        });
        body.appendChild(list);
      }
    });
  }

  function openForm(id) {
    const current = id ? Store.byId('wishes', id) : null;
    const names = people();
    if (!names.length) { Settings.openWishlistPeople(); return; }
    const draft = {
      title: current ? current.title : '',
      person: current && names.includes(current.person) ? current.person : names[0],
      desireLevel: current ? normalizeDesire(current.desireLevel || '') : '',
      price: current ? Number(current.price) || 0 : 0,
      urls: current ? (Array.isArray(current.urls) && current.urls.length ? current.urls.slice() : current.url ? [current.url] : ['']) : ['']
    };
    Sheet.open({
      title: current ? 'Изменить желание' : 'Новое желание',
      build(body) {
        const price = el('input', { class: 'input wish-price-input', id: 'wish-price', type: 'text', inputmode: 'decimal', value: draft.price ? nf0.format(draft.price) : '', placeholder: '0', autocomplete: 'off' });
        price.addEventListener('input', () => { draft.price = parseNum(price.value); });
        const priceField = field('Цена, ₽', price, 'wish-price');
        const title = el('input', { class: 'input', id: 'wish-title', value: draft.title, placeholder: 'Например, книга', autocomplete: 'off', 'data-autofocus': true });
        title.addEventListener('input', () => { draft.title = title.value; });
        const owner = segmented(names.map(name => ({ value: name, label: name })), draft.person, value => { draft.person = value; });
        owner.classList.add('segmented--status', 'wish-owner-picker');
        body.appendChild(el('div', { class: 'field-row wish-price-owner-row' }, [
          priceField,
          field('Кто добавил', owner, 'wish-owner')
        ]));
        body.appendChild(field('Название желания', title, 'wish-title'));
        const linksField = el('div', { class: 'wish-links-field' });
        const linksList = el('div', { class: 'wish-links-inputs' });
        const renderLinkInputs = () => {
          linksList.replaceChildren();
          draft.urls.forEach((value, index) => {
            const input = el('input', { class: 'input', type: 'url', inputmode: 'url', value, placeholder: 'Ссылка на подарок', autocomplete: 'url', 'aria-label': 'Ссылка ' + (index + 1) });
            input.addEventListener('input', () => { draft.urls[index] = input.value; });
            const remove = el('button', { class: 'wish-link-remove', type: 'button', text: '×', 'aria-label': 'Убрать ссылку', onclick: () => {
              draft.urls.splice(index, 1);
              if (!draft.urls.length) draft.urls.push('');
              renderLinkInputs();
            } });
            linksList.appendChild(el('div', { class: 'wish-link-input-row' }, [input, remove]));
          });
        };
        renderLinkInputs();
        const addLink = el('button', { class: 'wish-add-link', type: 'button', onclick: () => {
          draft.urls.push('');
          renderLinkInputs();
          linksList.lastElementChild?.querySelector('input')?.focus({ preventScroll: true });
        } }, [el('span', { class: 'wish-add-link-plus', text: '+' }), el('span', { text: 'Добавить ссылку' })]);
        linksField.append(linksList, addLink);
        body.appendChild(field('Ссылки', linksField, 'wish-links'));
        const desireQuick = el('div', { class: 'quick-cats wish-desire-picker', role: 'group', 'aria-label': 'Важность подарка' });
        const desireWrap = el('div', { class: 'quick-wrap' }, [desireQuick]);
        const desireOptions = desireLevels;
        const syncDesire = () => {
          $$('.quick-cat', desireQuick).forEach(button => setAttr(button, 'aria-pressed', button.dataset.value === draft.desireLevel ? 'true' : 'false'));
        };
        desireOptions.forEach(option => {
          const button = el('button', {
            class: 'quick-cat', type: 'button', text: option.label,
            'aria-pressed': draft.desireLevel === option.value ? 'true' : 'false',
            style: '--dot:' + option.color + ';--tint:' + option.color + '1f',
            onclick: () => {
              draft.desireLevel = option.value;
              syncDesire();
              requestAnimationFrame(() => button.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }));
            }
          });
          button.dataset.value = option.value;
          desireQuick.appendChild(button);
        });
        const updateDesireFade = () => {
          const more = desireQuick.scrollWidth - desireQuick.clientWidth - desireQuick.scrollLeft > 8;
          setAttr(desireWrap, 'data-more', more ? true : null);
        };
        desireQuick.addEventListener('scroll', updateDesireFade, { passive: true });
        requestAnimationFrame(updateDesireFade);
        body.appendChild(field('Важность подарка', desireWrap));
      },
      footer(foot) {
        foot.appendChild(el('button', { class: 'btn btn--block', type: 'button', text: current ? 'Сохранить' : 'Добавить желание', onclick: () => {
          const title = draft.title.trim();
          if (!title) { Toast.show('Напишите, что добавить в вишлист', { kind: 'err' }); return; }
          const rawUrls = draft.urls.map(value => String(value || '').trim()).filter(Boolean);
          const urls = rawUrls.map(safeUrl);
          if (urls.some(url => !url)) { Toast.show('Проверьте ссылки', { kind: 'err' }); return; }
          const validUrls = [...new Set(urls)];
          const payload = { title, person: draft.person, desireLevel: draft.desireLevel, price: Math.max(0, Number(draft.price) || 0), urls: validUrls, url: validUrls[0] || '',
            status: current ? current.status : 'wanted' };
          if (current) Store.patch('wishes', current.id, payload, title);
          else Store.add('wishes', payload, title);
          Sheet.close();
          Toast.show(current ? 'Желание обновлено' : 'Желание добавлено');
        } }));
      }
    });
  }

  function remove(id) {
    const rec = Store.byId('wishes', id);
    if (!rec) return;
    Store.remove('wishes', id, rec.title);
    Toast.show('«' + rec.title + '» в корзине', { action: { label: 'Вернуть', run: () => Store.restore('wishes', id) } });
  }

  return { mount, render };
})();
