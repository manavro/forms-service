// Вкладки страницы формы в админке: «Конструктор» и «Ответы».

import { h } from '../dom.js';

const TABS = [
  { id: 'builder', title: 'Конструктор', path: '' },
  { id: 'responses', title: 'Ответы', path: '/responses' },
];

// active — id текущей вкладки; counts — необязательные числа рядом с названием, например { responses: 12 }.
export function formTabs(formId, active, counts = {}) {
  const base = `/admin/forms/${encodeURIComponent(formId)}`;
  return h(
    'nav',
    { class: 'tabs', 'aria-label': 'Разделы формы' },
    TABS.map((tab) =>
      h(
        'a',
        {
          class: ['tab', tab.id === active && 'is-active'],
          href: base + tab.path,
          'aria-current': tab.id === active ? 'page' : undefined,
        },
        tab.title,
        counts[tab.id] !== undefined && h('span', { class: 'tab-count' }, String(counts[tab.id])),
      ),
    ),
  );
}
