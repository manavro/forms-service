// Приём ответов студентов по публичной ссылке.
//
// Ответ хранится вместе с «снимком» вопросов: текст вопроса, тип и подписи
// выбранных вариантов записываются в ответ в момент отправки. Если менеджер
// потом переименует или удалит вопрос, старые ответы останутся понятными.

import crypto from 'node:crypto';
import { ValidationError, gone, notFound } from '../errors.js';
import { ID_PATTERN } from '../ids.js';
import { validateAnswers } from '../shared/answers.js';

export function createResponseService(store) {
  // Опубликованная форма по ссылке. Черновик снаружи не виден — как будто его нет.
  function findPublicForm(state, slug) {
    const form = state.forms.find((f) => f.slug === slug);
    if (!form || form.status === 'draft') throw notFound('Форма не найдена');
    if (form.status === 'closed') throw closedError(form);
    return form;
  }

  return {
    // Форма для студента: только то, что нужно для заполнения, без служебных данных.
    getPublicForm(slug) {
      const form = findPublicForm(store.state, slug);
      return {
        slug: form.slug,
        title: form.title,
        description: form.description,
        fields: form.fields,
      };
    },

    // body: { answers: { [id поля]: значение }, submissionId?, website? }
    submit(slug, body) {
      const input = body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {};

      // Ловушка для ботов: поле website скрыто от людей, его заполняют только программы,
      // которые вписывают что-то во все поля подряд. Делаем вид, что всё прошло успешно,
      // но ничего не сохраняем.
      if (typeof input.website === 'string' && input.website.trim() !== '') {
        findPublicForm(store.state, slug);
        return Promise.resolve({ duplicate: false });
      }

      const submissionId =
        typeof input.submissionId === 'string' && ID_PATTERN.test(input.submissionId) ? input.submissionId : null;

      return store.update((state) => {
        const form = findPublicForm(state, slug);

        // Повторная отправка того же ответа (двойной клик, повтор после сбоя сети) —
        // не создаём дубль, просто подтверждаем, что ответ уже принят.
        if (submissionId && state.responses.some((r) => r.formId === form.id && r.submissionId === submissionId)) {
          return { duplicate: true };
        }

        const { values, errors } = validateAnswers(form.fields, input.answers);
        const errorList = Object.entries(errors).map(([path, message]) => ({ path, message }));
        if (errorList.length > 0) throw new ValidationError(errorList, 'Проверьте ответы');

        state.responses.push({
          id: crypto.randomUUID(),
          formId: form.id,
          formVersion: form.version,
          submissionId,
          submittedAt: new Date().toISOString(),
          answers: form.fields.map((field) => snapshotAnswer(field, values[field.id])),
        });
        return { duplicate: false };
      });
    },
  };
}

function closedError(form) {
  return gone('Приём ответов по этой форме завершён', { title: form.title });
}

// Ответ на одно поле вместе с текстом вопроса.
// Для вариантов сохраняем и id (по нему можно считать статистику), и подпись (её видно в таблице).
function snapshotAnswer(field, value) {
  let stored = value;
  if (field.type === 'single_choice' || field.type === 'dropdown') {
    const option = field.options.find((o) => o.id === value);
    stored = option ? { id: option.id, label: option.label } : null;
  } else if (field.type === 'multiple_choice') {
    stored = field.options.filter((o) => value.includes(o.id)).map((o) => ({ id: o.id, label: o.label }));
  }
  return { fieldId: field.id, type: field.type, label: field.label, value: stored };
}
