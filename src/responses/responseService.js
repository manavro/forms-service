// Приём ответов студентов по публичной ссылке.
//
// Ответ хранится вместе с «снимком» вопросов: текст вопроса, тип и подписи
// выбранных вариантов записываются в ответ в момент отправки. Если менеджер
// потом переименует или удалит вопрос, старые ответы останутся понятными.

import crypto from 'node:crypto';
import { ValidationError, gone, notFound } from '../errors.js';
import { ID_PATTERN } from '../ids.js';
import { validateAnswers } from '../shared/answers.js';
import { buildResponseTable } from './responseTable.js';

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

    // Все ответы на форму в виде таблицы (для админки и CSV).
    table(formId) {
      const { forms, responses } = store.state;
      const form = forms.find((f) => f.id === formId);
      if (!form) throw notFound('Форма не найдена');
      return {
        form,
        table: buildResponseTable(
          form,
          responses.filter((r) => r.formId === formId),
        ),
      };
    },

    // Удалить один ответ (например, тестовый). Возвращает номер сессии ответа,
    // чтобы вместе с ответом можно было удалить и его след в аналитике.
    remove(formId, responseId) {
      return store.update((state) => {
        const index = state.responses.findIndex((r) => r.id === responseId && r.formId === formId);
        if (index === -1) throw notFound('Ответ не найден');
        const [removed] = state.responses.splice(index, 1);
        return { sessionId: sessionIdOf(removed) };
      });
    },

    // body: { answers: { [id поля]: значение }, submissionId?, website? }
    // Возвращает { saved, formId, sessionId }: saved = false для дубля и для бота.
    submit(slug, body) {
      const input = body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {};

      // Ловушка для ботов: поле website скрыто от людей, его заполняют только программы,
      // которые вписывают что-то во все поля подряд. Делаем вид, что всё прошло успешно,
      // но ничего не сохраняем.
      if (typeof input.website === 'string' && input.website.trim() !== '') {
        const form = findPublicForm(store.state, slug);
        return Promise.resolve({ saved: false, formId: form.id, sessionId: null });
      }

      const submissionId =
        typeof input.submissionId === 'string' && ID_PATTERN.test(input.submissionId) ? input.submissionId : null;

      return store.update((state) => {
        const form = findPublicForm(state, slug);

        // Повторная отправка того же ответа (двойной клик, повтор после сбоя сети) —
        // не создаём дубль, просто подтверждаем, что ответ уже принят.
        if (submissionId && state.responses.some((r) => r.formId === form.id && r.submissionId === submissionId)) {
          return { saved: false, formId: form.id, sessionId: submissionId };
        }

        const { values, errors } = validateAnswers(form.fields, input.answers);
        const errorList = Object.entries(errors).map(([path, message]) => ({ path, message }));
        if (errorList.length > 0) throw new ValidationError(errorList, 'Проверьте ответы');

        const response = {
          id: crypto.randomUUID(),
          formId: form.id,
          formVersion: form.version,
          submissionId,
          submittedAt: new Date().toISOString(),
          answers: form.fields.map((field) => snapshotAnswer(field, values[field.id])),
        };
        state.responses.push(response);
        return { saved: true, formId: form.id, sessionId: sessionIdOf(response) };
      });
    },
  };
}

// Номер сессии ответа в аналитике. Страница формы использует submissionId и как номер
// сессии для событий; если ответ прислали без него (напрямую через API) — берём id ответа.
function sessionIdOf(response) {
  return response.submissionId ?? response.id;
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
