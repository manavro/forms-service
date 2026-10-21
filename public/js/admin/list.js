// Главная страница админки: список форм.

import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { copyText, countLabel, formatDate, publicFormUrl, statusBadge, toast } from '../ui.js';

const container = document.getElementById('forms');
const createButton = document.getElementById('create-form');

createButton.addEventListener('click', createForm);
load();

async function load() {
  try {
    const { forms } = await api('GET', '/api/forms');
    render(forms);
  } catch (err) {
    mount(
      container,
      h('div', { class: 'notice notice-error', role: 'alert' }, `Не удалось загрузить формы. ${err.message}`),
    );
  }
}

function render(forms) {
  if (forms.length === 0) {
    mount(
      container,
      h(
        'div',
        { class: 'card empty' },
        h('h2', null, 'Пока нет ни одной формы'),
        h('p', { class: 'muted' }, 'Соберите первую форму отклика — это займёт пару минут.'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: createForm }, 'Создать форму'),
      ),
    );
    return;
  }

  mount(container, h('ul', { class: 'form-list' }, forms.map(renderItem)));
}

function renderItem(form) {
  const editUrl = `/admin/forms/${form.id}`;
  const isPublic = form.status !== 'draft';

  return h(
    'li',
    { class: 'card form-item' },
    h(
      'div',
      { class: 'form-item-main' },
      h('a', { class: 'form-item-title', href: editUrl }, form.title),
      statusBadge(form.status),
      h(
        'p',
        { class: 'form-item-meta' },
        [
          countLabel(form.fieldCount, ['поле', 'поля', 'полей']),
          countLabel(form.responseCount, ['ответ', 'ответа', 'ответов']),
          `изменена ${formatDate(form.updatedAt)}`,
        ].join(' · '),
      ),
    ),
    h(
      'div',
      { class: 'row' },
      h('a', { class: 'btn btn-sm', href: editUrl }, 'Редактировать'),
      h('a', { class: 'btn btn-sm', href: `${editUrl}/responses` }, `Ответы (${form.responseCount})`),
      isPublic &&
        h(
          'button',
          {
            class: 'btn btn-sm',
            type: 'button',
            onclick: async () => {
              const ok = await copyText(publicFormUrl(form.slug));
              toast(ok ? 'Ссылка скопирована' : 'Не удалось скопировать ссылку', ok ? 'success' : 'error');
            },
          },
          'Скопировать ссылку',
        ),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => duplicateForm(form) }, 'Копия'),
      h(
        'button',
        { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => deleteForm(form) },
        'Удалить',
      ),
    ),
  );
}

async function createForm() {
  createButton.disabled = true;
  try {
    const { form } = await api('POST', '/api/forms', { title: 'Новая форма' });
    location.href = `/admin/forms/${form.id}`;
  } catch (err) {
    toast(err.message, 'error');
    createButton.disabled = false;
  }
}

async function duplicateForm(form) {
  try {
    await api('POST', `/api/forms/${form.id}/duplicate`);
    toast('Копия создана — она в начале списка', 'success');
    await load();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteForm(form) {
  const responsesWarning =
    form.responseCount > 0
      ? `\n\nВместе с ней удалятся ${countLabel(form.responseCount, ['ответ', 'ответа', 'ответов'])}.`
      : '';
  if (!confirm(`Удалить форму «${form.title}»?${responsesWarning}\n\nЭто действие нельзя отменить.`)) return;

  try {
    await api('DELETE', `/api/forms/${form.id}`);
    toast('Форма удалена');
    await load();
  } catch (err) {
    toast(err.message, 'error');
  }
}
