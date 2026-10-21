// Операции с формами: всё, что менеджер может сделать с формой в админке.
//
// Жизненный цикл формы:
//   draft (черновик)  → published (опубликована) — по ссылке можно отвечать;
//   published         → closed (приём закрыт)    — ссылка показывает «приём завершён»;
//   closed            → published                — приём можно открыть снова.
// Вернуть опубликованную форму в черновик нельзя: на неё уже могли ответить.
//
// Защита от одновременного редактирования: у формы есть номер версии.
// При сохранении клиент присылает версию, которую он редактировал. Если форму
// за это время сохранили в другой вкладке, версии не совпадут — вернём ошибку 409,
// а не перезапишем чужие изменения молча.

import crypto from 'node:crypto';
import { FORM_LIMITS } from '../shared/fieldTypes.js';
import { ValidationError, conflict, notFound } from '../errors.js';
import { randomId } from '../ids.js';
import { parseFormContent } from './formModel.js';

export function createFormService(store) {
  function findForm(state, id) {
    const form = state.forms.find((f) => f.id === id);
    if (!form) throw notFound('Форма не найдена');
    return form;
  }

  function uniqueSlug(state) {
    let slug;
    do {
      slug = randomId(9);
    } while (state.forms.some((f) => f.slug === slug));
    return slug;
  }

  function requireFields(fields) {
    if (fields.length === 0) {
      throw new ValidationError([{ path: 'fields', message: 'Добавьте в форму хотя бы одно поле' }]);
    }
  }

  return {
    // Список форм для главной страницы админки — без полей, но с числом ответов.
    list() {
      const { forms, responses } = store.state;
      const responseCounts = new Map();
      for (const r of responses) responseCounts.set(r.formId, (responseCounts.get(r.formId) ?? 0) + 1);

      return forms
        .map((form) => ({
          id: form.id,
          slug: form.slug,
          title: form.title,
          status: form.status,
          fieldCount: form.fields.length,
          responseCount: responseCounts.get(form.id) ?? 0,
          createdAt: form.createdAt,
          updatedAt: form.updatedAt,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    get(id) {
      return findForm(store.state, id);
    },

    create(input) {
      const content = parseFormContent(input);
      return store.update((state) => {
        const now = new Date().toISOString();
        const form = {
          id: crypto.randomUUID(),
          // Ссылка для студентов отделена от id: при необходимости её можно
          // будет перевыпустить, не трогая саму форму и ответы.
          slug: uniqueSlug(state),
          ...content,
          status: 'draft',
          version: 1,
          createdAt: now,
          updatedAt: now,
          publishedAt: null,
          closedAt: null,
        };
        state.forms.push(form);
        return form;
      });
    },

    update(id, input) {
      // Сначала 404 для несуществующей формы, и только потом проверка содержимого.
      findForm(store.state, id);
      const version = input?.version;
      if (!Number.isInteger(version)) {
        throw new ValidationError([{ path: 'version', message: 'Не указана версия формы' }]);
      }
      const content = parseFormContent(input);

      return store.update((state) => {
        const form = findForm(state, id);
        if (form.version !== version) {
          throw conflict('Форму уже изменили в другой вкладке или окне. Обновите страницу, чтобы увидеть свежую версию.');
        }
        // У опубликованной формы нельзя удалить все поля: студентам будет нечего заполнять.
        if (form.status !== 'draft') requireFields(content.fields);

        Object.assign(form, content, { version: form.version + 1, updatedAt: new Date().toISOString() });
        return form;
      });
    },

    publish(id) {
      return store.update((state) => {
        const form = findForm(state, id);
        if (form.status === 'published') return form;
        requireFields(form.fields);

        const now = new Date().toISOString();
        Object.assign(form, { status: 'published', publishedAt: now, closedAt: null, updatedAt: now });
        return form;
      });
    },

    close(id) {
      return store.update((state) => {
        const form = findForm(state, id);
        if (form.status === 'closed') return form;
        if (form.status === 'draft') throw conflict('Форма ещё не опубликована — закрывать нечего');

        const now = new Date().toISOString();
        Object.assign(form, { status: 'closed', closedAt: now, updatedAt: now });
        return form;
      });
    },

    // Копия формы — удобно, когда новая стажировка похожа на прошлую.
    // Ответы не копируются, копия всегда начинается с черновика.
    duplicate(id) {
      return store.update((state) => {
        const source = findForm(state, id);
        const now = new Date().toISOString();
        const copy = {
          id: crypto.randomUUID(),
          slug: uniqueSlug(state),
          title: `${source.title} (копия)`.slice(0, FORM_LIMITS.titleMax),
          description: source.description,
          fields: structuredClone(source.fields),
          status: 'draft',
          version: 1,
          createdAt: now,
          updatedAt: now,
          publishedAt: null,
          closedAt: null,
        };
        state.forms.push(copy);
        return copy;
      });
    },

    // Удаляет форму вместе с её ответами.
    remove(id) {
      return store.update((state) => {
        findForm(state, id);
        state.forms = state.forms.filter((f) => f.id !== id);
        state.responses = state.responses.filter((r) => r.formId !== id);
      });
    },
  };
}
