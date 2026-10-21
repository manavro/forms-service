// Отрисовка формы для заполнения.
//
// Используется в двух местах: на публичной странице у студента и в предпросмотре
// в конструкторе. Поэтому сама отправка вынесена наружу (onSubmit), а здесь —
// только поля, ввод и проверка ответов.
//
// Когда показываем ошибки:
// - при уходе из заполненного поля — если ответ неверный (например, почта без @);
// - пустые обязательные поля — только при попытке отправить, чтобы не ругаться
//   на человека, который просто переходит по полям клавишей Tab;
// - после первой попытки отправить ошибки обновляются сразу по мере исправления.

import { h } from '../dom.js';
import { ANSWER_LIMITS, validateAnswer, validateAnswers } from '/shared/answers.js';

// Берёт из сохранённых ответов только то, что подходит текущей форме: если организатор
// успел удалить вопрос или вариант, устаревшее значение молча отбрасывается.
function restoreAnswers(fields, saved) {
  const source = saved !== null && typeof saved === 'object' ? saved : {};
  const result = {};
  for (const field of fields) {
    if (!Object.hasOwn(source, field.id)) continue;
    const raw = source[field.id];
    const optionIds = new Set((field.options ?? []).map((o) => o.id));
    if (TEXT_INPUTS[field.type] && typeof raw === 'string') result[field.id] = raw;
    else if ((field.type === 'single_choice' || field.type === 'dropdown') && optionIds.has(raw)) result[field.id] = raw;
    else if (field.type === 'multiple_choice' && Array.isArray(raw)) result[field.id] = raw.filter((id) => optionIds.has(id));
    else if (field.type === 'checkbox' && typeof raw === 'boolean') result[field.id] = raw;
  }
  return result;
}

const TEXT_INPUTS = {
  short_text: { tag: 'input', attrs: { type: 'text' }, max: ANSWER_LIMITS.shortTextMax },
  long_text: { tag: 'textarea', attrs: { rows: 4 }, max: ANSWER_LIMITS.longTextMax },
  email: { tag: 'input', attrs: { type: 'email', inputmode: 'email', autocomplete: 'email' }, max: ANSWER_LIMITS.emailMax },
  phone: { tag: 'input', attrs: { type: 'tel', inputmode: 'tel', autocomplete: 'tel' }, max: ANSWER_LIMITS.phoneMax },
};

// form: { title, description, fields }
// onSubmit({ answers, website }) — вызывается, когда все ответы прошли проверку.
//   Может бросить ApiError: ошибки по полям (details) покажутся у полей, остальное — под кнопкой.
// hooks — необязательные обработчики для аналитики (в предпросмотре их нет):
//   onFieldFocus(field)         — студент перешёл к полю;
//   onFieldChange(field, value) — изменился ответ;
//   onFieldError(field)         — у поля появилась ошибка.
// initialAnswers — ответы, с которыми форма откроется (например, из сохранённого черновика).
// notice — элемент над формой (например, сообщение о восстановленном черновике).
//
// Возвращает { element, getAnswers }.
export function createFormView(form, { onSubmit, submitLabel = 'Отправить', hooks = {}, notice = null, initialAnswers = {} }) {
  const answers = restoreAnswers(form.fields, initialAnswers); // id поля → текущее значение
  const touched = new Set(); // поля, ошибки которых уже нужно показывать
  const questions = new Map(); // id поля → { wrapper, inputs, errorEl }
  let submitting = false;

  // Прогресс: сколько вопросов уже с ответом и сколько обязательных осталось.
  // Студенту проще дойти до конца, когда видно, сколько ещё впереди.
  const progressText = h('span', { class: 'pf-progress-text' });
  const progressBar = h('progress', { class: 'pf-progress-bar', max: form.fields.length, 'aria-label': 'Заполнено вопросов' });
  const progress = form.fields.length >= 2 ? h('div', { class: 'pf-progress' }, progressText, progressBar) : null;

  const summary = h('div', { class: 'pf-summary', role: 'alert', tabindex: '-1', hidden: true });
  const submitError = h('p', { class: 'pf-submit-error', role: 'alert', hidden: true });
  const submitButton = h('button', { class: 'btn btn-primary pf-submit', type: 'submit' }, submitLabel);

  // Ловушка для ботов: поле скрыто от людей и от программ чтения с экрана.
  const honeypot = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' });

  const formEl = h(
    'form',
    { class: 'pf-form', novalidate: true, onsubmit: handleSubmit },
    summary,
    form.fields.map(renderQuestion),
    h('div', { class: 'pf-trap', 'aria-hidden': 'true' }, h('label', null, 'Не заполняйте это поле', honeypot)),
    h('div', { class: 'pf-actions' }, submitButton, submitError),
  );

  const element = h(
    'div',
    { class: 'pf' },
    h(
      'header',
      { class: 'pf-card pf-header' },
      h('h1', { class: 'pf-title' }, form.title),
      form.description && h('p', { class: 'pf-description' }, form.description),
      form.fields.some((f) => f.required) &&
        h('p', { class: 'pf-legend' }, h('span', { class: 'pf-star', 'aria-hidden': 'true' }, '*'), ' — обязательный вопрос'),
    ),
    notice,
    progress,
    formEl,
  );
  updateProgress();

  return { element, getAnswers: () => ({ ...answers }) };

  // ---------- Поля ----------

  function renderQuestion(field) {
    const inputId = `a-${field.id}`;
    const helpId = `${inputId}-help`;
    const errorId = `${inputId}-error`;
    const describedBy = [field.help && helpId, errorId].filter(Boolean).join(' ');
    const label = field.label || 'Вопрос без текста';

    const requiredMark = field.required
      ? [
          h('span', { class: 'pf-star', 'aria-hidden': 'true' }, ' *'),
          h('span', { class: 'visually-hidden' }, ' (обязательный вопрос)'),
        ]
      : null;
    const help = field.help ? h('p', { class: 'pf-help', id: helpId }, field.help) : null;
    const errorEl = h('p', { class: 'pf-error', id: errorId });

    let wrapper;
    let inputs;

    if (TEXT_INPUTS[field.type]) {
      const { tag, attrs, max } = TEXT_INPUTS[field.type];
      const input = h(tag, {
        ...attrs,
        id: inputId,
        class: tag === 'textarea' ? 'textarea' : 'input',
        placeholder: field.placeholder || undefined,
        maxLength: max,
        value: answers[field.id] ?? '',
        'aria-required': field.required ? 'true' : undefined,
        'aria-describedby': describedBy,
        onfocus: () => hooks.onFieldFocus?.(field),
        oninput: (event) => setAnswer(field, event.target.value),
        // При уходе из поля проверяем только непустой ответ.
        onblur: () => {
          if (!isEmpty(answers[field.id])) touched.add(field.id);
          refreshError(field);
        },
      });
      inputs = [input];
      wrapper = h(
        'div',
        { class: 'pf-card pf-question', id: `q-${field.id}` },
        h('label', { class: 'pf-label', for: inputId }, label, requiredMark),
        help,
        input,
        errorEl,
      );
    } else if (field.type === 'dropdown') {
      const select = h(
        'select',
        {
          id: inputId,
          class: 'select',
          value: answers[field.id] ?? '',
          'aria-required': field.required ? 'true' : undefined,
          'aria-describedby': describedBy,
          onfocus: () => hooks.onFieldFocus?.(field),
          onchange: (event) => {
            touched.add(field.id);
            setAnswer(field, event.target.value || null);
          },
        },
        h('option', { value: '' }, 'Выберите вариант'),
        field.options.map((o) => h('option', { value: o.id }, o.label || 'Вариант без текста')),
      );
      inputs = [select];
      wrapper = h(
        'div',
        { class: 'pf-card pf-question', id: `q-${field.id}` },
        h('label', { class: 'pf-label', for: inputId }, label, requiredMark),
        help,
        select,
        errorEl,
      );
    } else if (field.type === 'single_choice' || field.type === 'multiple_choice') {
      const multiple = field.type === 'multiple_choice';
      inputs = field.options.map((option, i) =>
        h('input', {
          type: multiple ? 'checkbox' : 'radio',
          name: inputId,
          value: option.id,
          // id только у первого варианта: на него ведёт ссылка из списка ошибок.
          id: i === 0 ? inputId : undefined,
          checked: multiple ? (answers[field.id] ?? []).includes(option.id) : answers[field.id] === option.id,
          onfocus: () => hooks.onFieldFocus?.(field),
          onchange: () => {
            touched.add(field.id);
            setAnswer(field, multiple ? inputs.filter((x) => x.checked).map((x) => x.value) : option.id);
          },
        }),
      );
      wrapper = h(
        'fieldset',
        {
          class: 'pf-card pf-question pf-group',
          id: `q-${field.id}`,
          'aria-describedby': describedBy,
          'aria-required': field.required && !multiple ? 'true' : undefined,
        },
        h('legend', { class: 'pf-label' }, label, requiredMark),
        help,
        multiple && h('p', { class: 'pf-help' }, 'Можно выбрать несколько вариантов'),
        h(
          'div',
          { class: 'pf-options' },
          field.options.map((option, i) =>
            h('label', { class: 'pf-option' }, inputs[i], h('span', null, option.label || 'Вариант без текста')),
          ),
        ),
        errorEl,
      );
    } else if (field.type === 'checkbox') {
      const input = h('input', {
        type: 'checkbox',
        id: inputId,
        checked: answers[field.id] === true,
        'aria-required': field.required ? 'true' : undefined,
        'aria-describedby': describedBy,
        onfocus: () => hooks.onFieldFocus?.(field),
        onchange: (event) => {
          touched.add(field.id);
          setAnswer(field, event.target.checked);
        },
      });
      inputs = [input];
      wrapper = h(
        'div',
        { class: 'pf-card pf-question', id: `q-${field.id}` },
        h('label', { class: 'pf-option pf-consent' }, input, h('span', null, label, requiredMark)),
        help,
        errorEl,
      );
    } else {
      // Неизвестный тип (не должно случаться) — не ломаем всю форму из-за одного поля.
      inputs = [];
      wrapper = h('div', { class: 'pf-card pf-question' }, h('p', { class: 'muted' }, label));
    }

    questions.set(field.id, { wrapper, inputs, errorEl });
    return wrapper;
  }

  // ---------- Ответы и ошибки ----------

  function setAnswer(field, value) {
    answers[field.id] = value;
    hooks.onFieldChange?.(field, value);
    refreshError(field);
    updateProgress();
  }

  function updateProgress() {
    if (!progress) return;
    const answered = form.fields.filter((f) => !isEmpty(answers[f.id])).length;
    const requiredLeft = form.fields.filter((f) => f.required && isEmpty(answers[f.id])).length;
    progressBar.value = answered;
    let text = `Заполнено ${answered} из ${form.fields.length}`;
    if (requiredLeft > 0) text += ` · обязательных осталось: ${requiredLeft}`;
    else if (form.fields.some((f) => f.required)) text += ' · все обязательные заполнены';
    progressText.textContent = text;
  }

  // Показывает или убирает ошибку поля, если её уже пора показывать.
  function refreshError(field) {
    const error = touched.has(field.id) ? validateAnswer(field, answers[field.id]).error : null;
    showError(field.id, error);
  }

  function showError(fieldId, message) {
    const question = questions.get(fieldId);
    if (!question) return;
    // Сообщаем аналитике только о появлении ошибки, а не о каждом нажатии клавиши, пока она висит.
    if (message && !question.wrapper.classList.contains('has-error')) {
      const field = form.fields.find((f) => f.id === fieldId);
      if (field) hooks.onFieldError?.(field);
    }
    question.errorEl.textContent = message ?? '';
    question.wrapper.classList.toggle('has-error', Boolean(message));
    for (const input of question.inputs) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    // Все ошибки исправлены — список над формой больше не нужен.
    if (!message && !summary.hidden && ![...questions.values()].some((q) => q.wrapper.classList.contains('has-error'))) {
      summary.hidden = true;
    }
  }

  // Список ошибок над формой со ссылками на поля — удобно, когда форма длинная.
  function showSummary(errors, extraMessages = []) {
    const items = Object.entries(errors).map(([fieldId, message]) => {
      const field = form.fields.find((f) => f.id === fieldId);
      return h(
        'li',
        null,
        h(
          'a',
          {
            href: `#a-${fieldId}`,
            onclick: (event) => {
              event.preventDefault();
              focusQuestion(fieldId);
            },
          },
          `${field?.label || 'Вопрос'}: ${message}`,
        ),
      );
    });
    summary.replaceChildren(
      h('h2', { class: 'pf-summary-title' }, 'Проверьте ответы'),
      h('ul', null, items, extraMessages.map((m) => h('li', null, m))),
    );
    summary.hidden = false;
    summary.focus();
  }

  function focusQuestion(fieldId) {
    const question = questions.get(fieldId);
    if (!question) return;
    question.wrapper.scrollIntoView({ block: 'center' });
    question.inputs[0]?.focus({ preventScroll: true });
  }

  function isEmpty(value) {
    return value === undefined || value === null || value === '' || value === false || (Array.isArray(value) && value.length === 0);
  }

  // ---------- Отправка ----------

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    submitError.hidden = true;

    const { values, errors } = validateAnswers(form.fields, answers);
    for (const field of form.fields) {
      touched.add(field.id);
      showError(field.id, errors[field.id]);
    }
    if (Object.keys(errors).length > 0) {
      showSummary(errors);
      return;
    }
    summary.hidden = true;

    setSubmitting(true);
    try {
      await onSubmit({ answers: values, website: honeypot.value });
    } catch (err) {
      if (err.details?.length > 0) showServerErrors(err.details);
      else {
        submitError.textContent = err.message || 'Не удалось отправить ответ. Попробуйте ещё раз.';
        submitError.hidden = false;
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Ошибки, найденные сервером. Если среди них есть поля, которых нет на странице,
  // значит, форму изменили, пока студент её заполнял.
  function showServerErrors(details) {
    const errors = {};
    const extra = [];
    for (const { path, message } of details) {
      if (questions.has(path)) {
        errors[path] = message;
        showError(path, message);
      } else if (!extra.length) {
        extra.push('Организатор изменил форму, пока вы её заполняли. Обновите страницу, чтобы увидеть актуальную версию.');
      }
    }
    showSummary(errors, extra);
  }

  function setSubmitting(value) {
    submitting = value;
    submitButton.disabled = value;
    submitButton.textContent = value ? 'Отправляю…' : submitLabel;
  }
}
