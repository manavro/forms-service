// Конструктор формы.
//
// Как устроено:
// - state.draft — то, что менеджер сейчас редактирует. Ввод текста меняет draft
//   напрямую, без перерисовки, чтобы не сбивать курсор.
// - Действия, меняющие структуру (добавить, удалить, переставить поле, сменить тип),
//   меняют draft и перерисовывают страницу целиком. Фокус после перерисовки
//   возвращается на нужный элемент по его ключу (data-focus-key).
// - Сохранение — по кнопке или Ctrl+S. Проверку делает сервер; его ошибки
//   показываются рядом с нужными полями.

import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { newId } from '../ids.js';
import { createFormView } from '../form/formView.js';
import { copyText, countLabel, plural, publicFormUrl, statusBadge, toast } from '../ui.js';
import { FIELD_TYPES, FORM_LIMITS } from '/shared/fieldTypes.js';

const formId = decodeURIComponent(location.pathname.split('/').pop());
const root = document.getElementById('builder');

const state = {
  form: null, // последняя версия формы, известная серверу
  draft: null, // редактируемая копия: { title, description, fields }
  responseCount: 0,
  dirty: false,
  changeSeq: 0, // растёт при каждой правке — чтобы не потерять ввод, сделанный во время сохранения
  busy: false,
  conflict: false,
  errors: new Map(), // ключ элемента → текст ошибки
  generalErrors: [], // ошибки, которые не привязать к конкретному полю
};

let panelEl;

load();

window.addEventListener('beforeunload', (event) => {
  if (state.dirty) event.preventDefault();
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    save();
  }
});

// ---------- Загрузка ----------

async function load() {
  try {
    const { form, responseCount } = await api('GET', `/api/forms/${encodeURIComponent(formId)}`);
    state.responseCount = responseCount;
    applyServerForm(form);
    render();
  } catch (err) {
    const notFound = err.status === 404;
    mount(
      root,
      h(
        'div',
        { class: 'card empty' },
        h('h1', null, notFound ? 'Форма не найдена' : 'Не удалось загрузить форму'),
        h('p', { class: 'muted' }, notFound ? 'Возможно, её удалили.' : err.message),
        h('a', { class: 'btn', href: '/admin' }, 'К списку форм'),
      ),
    );
  }
}

function applyServerForm(form) {
  state.form = form;
  state.draft = structuredClone({ title: form.title, description: form.description, fields: form.fields });
  state.dirty = false;
  document.title = `${form.title} · Конструктор`;
}

function markChanged() {
  state.changeSeq++;
  if (!state.dirty) {
    state.dirty = true;
    updatePanel();
  }
}

// ---------- Отрисовка ----------

function render(focusKeys) {
  const activeKey = document.activeElement?.dataset?.focusKey;
  const scrollY = window.scrollY;

  panelEl = h('div', { class: 'builder-panel' });
  const { draft } = state;

  mount(
    root,
    h('a', { class: 'back-link', href: '/admin' }, '← Все формы'),
    panelEl,
    state.conflict &&
      h(
        'div',
        { class: 'notice notice-error', role: 'alert' },
        h('p', null, 'Форму уже изменили в другой вкладке или окне. Чтобы не затереть чужие изменения, сохранение остановлено.'),
        h('p', null, 'Скопируйте свои правки, если они нужны, и обновите страницу.'),
        h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Обновить страницу'),
      ),
    state.responseCount > 0 &&
      h(
        'div',
        { class: 'notice notice-warning' },
        `На форму уже есть ${countLabel(state.responseCount, ['ответ', 'ответа', 'ответов'])}. `,
        'Изменения увидят только новые студенты. Уже полученные ответы не пропадут: они хранятся вместе с текстами вопросов на момент отправки.',
      ),
    state.generalErrors.length > 0 &&
      h(
        'div',
        { class: 'notice notice-error', role: 'alert' },
        h('ul', null, state.generalErrors.map((message) => h('li', null, message))),
      ),
    h(
      'section',
      { class: 'card stack', 'aria-label': 'Основное' },
      textControl({
        key: 'title',
        label: 'Название формы',
        value: draft.title,
        max: FORM_LIMITS.titleMax,
        hint: 'Студент увидит его вверху страницы.',
        onInput: (value) => {
          draft.title = value;
          document.title = `${value || 'Без названия'} · Конструктор`;
        },
      }),
      textControl({
        key: 'description',
        label: 'Описание',
        value: draft.description,
        max: FORM_LIMITS.descriptionMax,
        multiline: true,
        hint: 'Необязательно. Например, о стажировке и сроках рассмотрения откликов.',
        onInput: (value) => {
          draft.description = value;
        },
      }),
    ),
    h(
      'section',
      { class: 'stack', 'aria-label': 'Поля формы' },
      h('h2', null, 'Поля'),
      errorText('fields'),
      draft.fields.length === 0 && h('p', { class: 'muted' }, 'В форме пока нет полей. Добавьте первое ниже.'),
      draft.fields.map((field, index) => renderField(field, index)),
      renderAddField(),
    ),
  );

  updatePanel();

  window.scrollTo(0, scrollY);
  const keys = focusKeys ? [focusKeys].flat() : activeKey ? [activeKey] : [];
  for (const key of keys) {
    const el = root.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
    if (el && !el.disabled) {
      el.focus({ preventScroll: !focusKeys });
      break;
    }
  }
}

// Верхняя панель: статус, сохранение, публикация, ссылка.
// Перерисовывается отдельно, чтобы ввод текста не перестраивал всю страницу.
function updatePanel() {
  if (!panelEl) return;
  const { form, busy, dirty, conflict } = state;

  let saveState = 'Все изменения сохранены';
  if (busy) saveState = 'Сохраняю…';
  else if (dirty) saveState = 'Есть несохранённые изменения';

  const actions = [];
  if (form.status === 'draft') {
    actions.push(button('Опубликовать', publish, { primary: true, disabled: busy || conflict }));
  } else if (form.status === 'published') {
    actions.push(button('Закрыть приём', closeForm, { disabled: busy }));
  } else {
    actions.push(button('Открыть приём снова', publish, { disabled: busy || conflict }));
  }

  const url = publicFormUrl(form.slug);
  mount(
    panelEl,
    statusBadge(form.status),
    h('span', { class: ['save-state', dirty && 'is-dirty'], role: 'status' }, saveState),
    h('span', { class: 'spacer' }),
    button('Предпросмотр', openPreview, { title: 'Как форму увидит студент — с учётом несохранённых правок' }),
    button('Сохранить', () => save(), {
      primary: form.status !== 'draft' && dirty,
      disabled: busy || !dirty || conflict,
      title: 'Ctrl+S',
    }),
    actions,
    form.status === 'draft'
      ? h('p', { class: 'hint panel-note' }, 'Ссылка для студентов появится после публикации.')
      : h(
          'div',
          { class: 'link-box', role: 'group', 'aria-label': 'Ссылка для студентов' },
          h('label', { class: 'visually-hidden', for: 'public-link' }, 'Ссылка для студентов'),
          h('input', {
            id: 'public-link',
            class: 'input',
            value: url,
            readOnly: true,
            onfocus: (event) => event.target.select(),
          }),
          button('Скопировать', async () => {
            const ok = await copyText(url);
            toast(ok ? 'Ссылка скопирована' : 'Не удалось скопировать ссылку', ok ? 'success' : 'error');
          }),
          h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'Открыть'),
        ),
  );
}

function renderField(field, index) {
  const info = FIELD_TYPES[field.type];
  const key = (part) => `${field.id}:${part}`;
  const total = state.draft.fields.length;
  const number = index + 1;

  return h(
    'article',
    { class: 'card field-card', 'aria-label': `Поле ${number}` },
    h(
      'div',
      { class: 'field-head' },
      h('span', { class: 'field-number', 'aria-hidden': 'true' }, `${number}.`),
      h('label', { class: 'visually-hidden', for: `in-${key('type')}` }, `Тип поля ${number}`),
      h(
        'select',
        {
          id: `in-${key('type')}`,
          class: 'select',
          value: field.type,
          dataset: { focusKey: key('type') },
          onchange: (event) => changeType(field, event.target.value),
        },
        Object.entries(FIELD_TYPES).map(([type, meta]) => h('option', { value: type }, meta.title)),
      ),
      h(
        'div',
        { class: 'field-tools' },
        iconButton('↑', `Поднять поле ${number}`, key('up'), () => moveField(index, -1), index === 0),
        iconButton('↓', `Опустить поле ${number}`, key('down'), () => moveField(index, 1), index === total - 1),
        iconButton('⧉', `Дублировать поле ${number}`, key('copy'), () => duplicateField(index), total >= FORM_LIMITS.fieldsMax),
        iconButton('✕', `Удалить поле ${number}`, key('delete'), () => removeField(index)),
      ),
    ),
    errorText(key('type')),
    h(
      'div',
      { class: 'field-body' },
      textControl({
        key: key('label'),
        label: field.type === 'checkbox' ? 'Текст рядом с галочкой' : 'Вопрос',
        value: field.label,
        max: FORM_LIMITS.labelMax,
        placeholder: field.type === 'checkbox' ? 'Например: согласен на обработку персональных данных' : 'Например: Ваше ФИО',
        onInput: (value) => {
          field.label = value;
        },
      }),
      textControl({
        key: key('help'),
        label: 'Подсказка',
        value: field.help,
        max: FORM_LIMITS.helpMax,
        hint: 'Необязательно. Показывается под вопросом мелким шрифтом.',
        onInput: (value) => {
          field.help = value;
        },
      }),
      info.hasPlaceholder &&
        textControl({
          key: key('placeholder'),
          label: 'Пример ответа внутри поля',
          value: field.placeholder ?? '',
          max: FORM_LIMITS.placeholderMax,
          hint: 'Необязательно. Серый текст в пустом поле, например «ivan@example.com».',
          onInput: (value) => {
            field.placeholder = value;
          },
        }),
      info.hasOptions && renderOptions(field),
      h(
        'label',
        { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: field.required,
          dataset: { focusKey: key('required') },
          onchange: (event) => {
            field.required = event.target.checked;
            markChanged();
          },
        }),
        field.type === 'checkbox' ? 'Обязательно: без галочки форму не отправить' : 'Обязательное поле',
      ),
    ),
  );
}

function renderOptions(field) {
  const key = (part) => `${field.id}:${part}`;
  const options = field.options;
  const marker = field.type === 'dropdown' ? null : field.type === 'multiple_choice' ? 'is-square' : '';

  return h(
    'fieldset',
    { class: 'options-group stack' },
    h('legend', { class: 'label' }, 'Варианты ответа'),
    h(
      'ul',
      { class: 'options' },
      options.map((option, i) =>
        h(
          'li',
          { class: 'option-row' },
          marker !== null && h('span', { class: ['option-marker', marker], 'aria-hidden': 'true' }),
          h(
            'div',
            { class: 'option-input' },
            textControl({
              key: key(`opt:${option.id}`),
              label: `Вариант ${i + 1}`,
              hideLabel: true,
              value: option.label,
              max: FORM_LIMITS.optionLabelMax,
              onInput: (value) => {
                option.label = value;
              },
              onKeydown: (event) => {
                // Enter в варианте — сразу добавить следующий: так варианты удобно вводить подряд.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addOption(field, i + 1);
                }
              },
            }),
          ),
          iconButton(
            '✕',
            `Удалить вариант ${i + 1}`,
            key(`opt-del:${option.id}`),
            () => removeOption(field, i),
            options.length <= FORM_LIMITS.optionsMin,
          ),
        ),
      ),
    ),
    errorText(key('options')),
    h(
      'div',
      null,
      button('+ Добавить вариант', () => addOption(field, options.length), {
        small: true,
        disabled: options.length >= FORM_LIMITS.optionsMax,
        focusKey: key('add-option'),
      }),
    ),
  );
}

function renderAddField() {
  const full = state.draft.fields.length >= FORM_LIMITS.fieldsMax;
  return h(
    'div',
    { class: 'card add-field' },
    h('p', { class: 'add-field-title' }, 'Добавить поле'),
    full
      ? h('p', { class: 'muted' }, `В форме может быть не больше ${FORM_LIMITS.fieldsMax} полей.`)
      : h(
          'div',
          { class: 'row' },
          Object.entries(FIELD_TYPES).map(([type, meta]) =>
            button(`+ ${meta.title}`, () => addField(type), { small: true, focusKey: `add:${type}` }),
          ),
        ),
  );
}

// Поле ввода с подписью, подсказкой и ошибкой от сервера.
function textControl({ key, label, value, max, hint, placeholder, multiline, hideLabel, onInput, onKeydown }) {
  const id = `in-${key}`;
  const error = state.errors.get(key);
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');

  const input = h(multiline ? 'textarea' : 'input', {
    id,
    class: multiline ? 'textarea' : 'input',
    type: multiline ? undefined : 'text',
    value,
    maxLength: max,
    placeholder,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': describedBy || undefined,
    dataset: { focusKey: key },
    onkeydown: onKeydown,
    oninput: (event) => {
      onInput(event.target.value);
      clearError(key, input);
      markChanged();
    },
  });

  return h(
    'div',
    null,
    h('label', { class: hideLabel ? 'visually-hidden' : 'label', for: id }, label),
    input,
    hint && h('p', { class: 'hint', id: `${id}-hint` }, hint),
    error && h('p', { class: 'error-text', id: `${id}-error` }, error),
  );
}

function errorText(key) {
  const error = state.errors.get(key);
  return error ? h('p', { class: 'error-text', role: 'alert' }, error) : null;
}

function clearError(key, input) {
  if (!state.errors.has(key)) return;
  state.errors.delete(key);
  input.removeAttribute('aria-invalid');
  document.getElementById(`${input.id}-error`)?.remove();
}

function button(text, onclick, { primary, small, disabled, title, focusKey } = {}) {
  return h(
    'button',
    {
      class: ['btn', primary && 'btn-primary', small && 'btn-sm'],
      type: 'button',
      disabled,
      title,
      dataset: focusKey ? { focusKey } : undefined,
      onclick,
    },
    text,
  );
}

function iconButton(icon, label, focusKey, onclick, disabled = false) {
  return h(
    'button',
    {
      class: 'btn btn-ghost btn-icon',
      type: 'button',
      'aria-label': label,
      title: label,
      disabled,
      dataset: { focusKey },
      onclick,
    },
    icon,
  );
}

// ---------- Правки структуры ----------

function newOption(label = '') {
  return { id: newId(), label };
}

function addField(type) {
  const field = { id: newId(), type, label: '', help: '', required: false };
  if (FIELD_TYPES[type].hasPlaceholder) field.placeholder = '';
  if (FIELD_TYPES[type].hasOptions) field.options = [newOption('Вариант 1'), newOption('Вариант 2')];
  state.draft.fields.push(field);
  markChanged();
  render(`${field.id}:label`);
}

function changeType(field, type) {
  field.type = type;
  const info = FIELD_TYPES[type];
  // Старые варианты и пример ответа не удаляем: если вернуть прежний тип, они снова пригодятся.
  // Сервер сохранит только то, что подходит новому типу.
  if (info.hasOptions && !field.options?.length) field.options = [newOption('Вариант 1'), newOption('Вариант 2')];
  if (info.hasPlaceholder && field.placeholder === undefined) field.placeholder = '';
  state.errors.delete(`${field.id}:type`);
  markChanged();
  render(`${field.id}:type`);
}

function moveField(index, delta) {
  const fields = state.draft.fields;
  const target = index + delta;
  if (target < 0 || target >= fields.length) return;
  [fields[index], fields[target]] = [fields[target], fields[index]];
  const id = fields[target].id;
  markChanged();
  // Фокус остаётся на той же кнопке у переехавшего поля; если она стала недоступна — на соседней.
  render(delta < 0 ? [`${id}:up`, `${id}:down`] : [`${id}:down`, `${id}:up`]);
}

function duplicateField(index) {
  const source = state.draft.fields[index];
  const copy = structuredClone(source);
  copy.id = newId();
  if (copy.options) copy.options = copy.options.map((o) => ({ ...o, id: newId() }));
  state.draft.fields.splice(index + 1, 0, copy);
  markChanged();
  render(`${copy.id}:label`);
}

function removeField(index) {
  const field = state.draft.fields[index];
  if (field.label.trim()) {
    const extra = state.responseCount > 0 ? '\n\nУже полученные ответы на этот вопрос сохранятся.' : '';
    if (!confirm(`Удалить поле «${field.label.trim()}»?${extra}`)) return;
  }
  state.draft.fields.splice(index, 1);
  markChanged();
  const next = state.draft.fields[index] ?? state.draft.fields[index - 1];
  render(next ? `${next.id}:label` : `add:short_text`);
}

function addOption(field, position) {
  if (field.options.length >= FORM_LIMITS.optionsMax) return;
  const option = newOption();
  field.options.splice(position, 0, option);
  state.errors.delete(`${field.id}:options`);
  markChanged();
  render(`${field.id}:opt:${option.id}`);
}

function removeOption(field, index) {
  const [removed] = field.options.splice(index, 1);
  state.errors.delete(`${field.id}:opt:${removed.id}`);
  markChanged();
  const next = field.options[index] ?? field.options[index - 1];
  render(`${field.id}:opt:${next.id}`);
}

// ---------- Предпросмотр ----------

// Показывает форму так, как её увидит студент, — та же отрисовка, что и на публичной странице.
// Берётся текущий черновик, поэтому несохранённые правки тоже видны. Ответ никуда не отправляется.
function openPreview() {
  const { draft } = state;
  const previewForm = {
    title: draft.title.trim() || 'Без названия',
    description: draft.description.trim(),
    fields: structuredClone(draft.fields),
  };

  const content = h('div', { class: 'preview-body' });
  const showForm = () => {
    const view = createFormView(previewForm, {
      submitLabel: 'Отправить',
      onSubmit: async () => {
        mount(
          content,
          h(
            'div',
            { class: 'pf' },
            h(
              'div',
              { class: 'pf-card pf-message is-success', role: 'status' },
              h('div', { class: 'pf-message-icon', 'aria-hidden': 'true' }, '✓'),
              h('h2', { class: 'pf-title' }, 'Всё заполнено верно'),
              h('p', { class: 'muted' }, 'Это предпросмотр: ответ никуда не отправлен. Студент увидит здесь «Спасибо! Ответ отправлен».'),
              h('button', { class: 'btn', type: 'button', onclick: showForm }, 'Заполнить ещё раз'),
            ),
          ),
        );
        content.scrollTop = 0;
      },
    });
    mount(content, view.element);
  };
  showForm();

  const dialog = h(
    'dialog',
    { class: 'preview-dialog', 'aria-label': 'Предпросмотр формы', onclose: () => dialog.remove() },
    h(
      'div',
      { class: 'preview-bar' },
      h('strong', null, 'Предпросмотр'),
      h('span', { class: 'muted small' }, 'Так форму увидит студент'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => dialog.close() }, 'Закрыть'),
    ),
    content,
  );
  document.body.append(dialog);
  dialog.showModal();
}

// ---------- Сохранение и публикация ----------

// Возвращает true, если форма сохранена.
async function save({ quiet = false } = {}) {
  if (state.busy || state.conflict) return false;
  if (!state.dirty) return true;

  const sent = structuredClone(state.draft);
  const seq = state.changeSeq;
  setBusy(true);
  try {
    const { form } = await api('PUT', `/api/forms/${encodeURIComponent(formId)}`, {
      ...sent,
      version: state.form.version,
    });
    if (state.changeSeq === seq) {
      // Пока шло сохранение, ничего не меняли — берём версию с сервера (она уже очищена от лишних пробелов).
      applyServerForm(form);
      state.errors.clear();
      state.generalErrors = [];
      state.busy = false;
      render();
    } else {
      // Пока шло сохранение, менеджер продолжал печатать — его новые правки не трогаем.
      state.form = form;
    }
    if (!quiet) toast('Сохранено', 'success');
    return true;
  } catch (err) {
    if (err.status === 409) {
      state.conflict = true;
      state.busy = false;
      render();
    } else if (err.status === 400 && err.details.length > 0) {
      showErrors(err.details, sent.fields);
    } else {
      toast(`Не удалось сохранить. ${err.message}`, 'error');
    }
    return false;
  } finally {
    setBusy(false);
  }
}

async function publish() {
  if (state.dirty && !(await save({ quiet: true }))) return;
  const wasDraft = state.form.status === 'draft';
  await runFormAction('publish', wasDraft ? 'Форма опубликована — ссылка для студентов вверху страницы' : 'Приём ответов снова открыт');
}

async function closeForm() {
  const ok = confirm(
    'Закрыть приём ответов?\n\nСтуденты, которые откроют ссылку, увидят, что приём завершён. Открыть приём снова можно в любой момент.',
  );
  if (ok) await runFormAction('close', 'Приём ответов закрыт');
}

async function runFormAction(action, successMessage) {
  setBusy(true);
  try {
    const { form } = await api('POST', `/api/forms/${encodeURIComponent(formId)}/${action}`);
    state.form = form;
    toast(successMessage, 'success');
  } catch (err) {
    if (err.status === 400 && err.details.length > 0) {
      showErrors(err.details, state.draft.fields, action === 'publish' ? 'опубликовать' : 'закрыть приём');
    } else {
      toast(err.message, 'error');
    }
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  state.busy = busy;
  updatePanel();
}

// Переводит пути ошибок от сервера (fields[2].options[1].label) в ключи элементов на странице.
// Пути содержат номера полей на момент отправки, поэтому сопоставляем их с отправленной копией.
function showErrors(details, sentFields, failedAction = 'сохранить') {
  state.errors.clear();
  state.generalErrors = [];
  for (const { path, message } of details) {
    const key = errorKey(path, sentFields);
    if (key) state.errors.set(key, message);
    else state.generalErrors.push(message);
  }
  state.busy = false;
  render();

  const count = details.length;
  toast(
    `Не удалось ${failedAction}: исправьте отмеченное красным (${count} ${plural(count, ['ошибка', 'ошибки', 'ошибок'])}).`,
    'error',
  );
  const first = root.querySelector('[aria-invalid="true"], .error-text');
  if (first) {
    first.scrollIntoView({ block: 'center' });
    if (first.matches('input, textarea, select')) first.focus({ preventScroll: true });
  }
}

function errorKey(path, sentFields) {
  if (path === 'title' || path === 'description' || path === 'fields') return path;

  const match = /^fields\[(\d+)\](?:\.(\w+)(?:\[(\d+)\])?(?:\.\w+)?)?$/.exec(path);
  const field = match && sentFields[Number(match[1])];
  if (!field) return null;

  const [, , prop, optionIndex] = match;
  if (prop === 'options' && optionIndex !== undefined) {
    const option = field.options?.[Number(optionIndex)];
    return option ? `${field.id}:opt:${option.id}` : `${field.id}:options`;
  }
  if (!prop || prop === 'id' || prop === 'type' || prop === 'required') return `${field.id}:type`;
  return `${field.id}:${prop}`;
}
