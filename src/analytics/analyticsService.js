// Приём событий со страницы формы и отчёт для админки.
//
// Что мы НЕ собираем: сами ответы, IP-адреса, cookie, данные браузера.
// Только «студент перешёл к полю N через столько-то секунд». По этим событиям
// нельзя узнать, что человек написал, и нельзя связать его визиты между собой.
//
// Публичный приём событий открыт всем, поэтому он строго проверяет вход:
// только опубликованная форма, известные типы событий, существующие поля,
// разумное время и ограничение на число событий в одной сессии.

import { ValidationError, notFound } from '../errors.js';
import { ID_PATTERN } from '../ids.js';
import { computeAnalytics } from './computeAnalytics.js';

const CLIENT_EVENT_TYPES = new Set(['view', 'focus', 'fill', 'error', 'leave']);
const FIELD_EVENT_TYPES = new Set(['focus', 'fill', 'error']);
const MAX_BATCH = 50;
const MAX_EVENTS_PER_SESSION = 500;
const MAX_ELAPSED_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function createAnalyticsService(db, eventLog) {
  // Сколько событий уже принято от каждой сессии — защита от засорения журнала.
  const sessionCounts = new Map();
  const key = (formId, sessionId) => `${formId}:${sessionId}`;
  for (const event of eventLog.events) {
    const k = key(event.formId, event.sessionId);
    sessionCounts.set(k, (sessionCounts.get(k) ?? 0) + 1);
  }

  return {
    // body: { sessionId, events: [{ type, fieldId?, t }] }
    // Возвращает число принятых событий. Некорректные события молча отбрасываются:
    // аналитика не должна ломать заполнение формы.
    async record(slug, body) {
      const form = db.state.forms.find((f) => f.slug === slug);
      if (!form || form.status === 'draft') throw notFound('Форма не найдена');
      // Закрытая форма: события больше не нужны, но и ошибкой это не считаем.
      if (form.status === 'closed') return 0;

      const input = body !== null && typeof body === 'object' ? body : {};
      if (typeof input.sessionId !== 'string' || !ID_PATTERN.test(input.sessionId)) {
        throw new ValidationError([{ path: 'sessionId', message: 'Некорректный номер сессии' }]);
      }
      if (!Array.isArray(input.events) || input.events.length > MAX_BATCH) {
        throw new ValidationError([{ path: 'events', message: `Ожидался список до ${MAX_BATCH} событий` }]);
      }

      const fieldIds = new Set(form.fields.map((f) => f.id));
      const sessionKey = key(form.id, input.sessionId);
      const room = MAX_EVENTS_PER_SESSION - (sessionCounts.get(sessionKey) ?? 0);
      const at = new Date().toISOString();

      const records = [];
      for (const raw of input.events) {
        if (records.length >= room) break;
        if (raw === null || typeof raw !== 'object') continue;
        if (!CLIENT_EVENT_TYPES.has(raw.type)) continue;
        if (!isElapsed(raw.t)) continue;
        if (FIELD_EVENT_TYPES.has(raw.type) && !fieldIds.has(raw.fieldId)) continue;

        const record = { formId: form.id, sessionId: input.sessionId, type: raw.type, t: Math.round(raw.t), at };
        if (FIELD_EVENT_TYPES.has(raw.type)) record.fieldId = raw.fieldId;
        records.push(record);
      }

      await eventLog.append(records);
      sessionCounts.set(sessionKey, (sessionCounts.get(sessionKey) ?? 0) + records.length);
      return records.length;
    },

    // Отметка об отправленном ответе. Пишет сервер, а не браузер: ответ уже сохранён,
    // значит, событие точно настоящее. elapsed — сколько мс прошло с открытия формы.
    recordSubmit(formId, sessionId, elapsed) {
      return eventLog.append([
        {
          formId,
          sessionId,
          type: 'submit',
          t: isElapsed(elapsed) ? Math.round(elapsed) : null,
          at: new Date().toISOString(),
        },
      ]);
    },

    // Отчёт для админки. days — за сколько последних дней (или null — за всё время).
    report(formId, { days = null } = {}) {
      const form = db.state.forms.find((f) => f.id === formId);
      if (!form) throw notFound('Форма не найдена');
      const now = Date.now();
      const events = eventLog.events.filter((e) => e.formId === formId);
      return {
        form,
        ...computeAnalytics(form, events, { now, since: days ? now - days * DAY_MS : null }),
      };
    },

    // Сбросить аналитику формы — например, после собственных тестовых заполнений.
    async reset(formId) {
      if (!db.state.forms.some((f) => f.id === formId)) throw notFound('Форма не найдена');
      await this.removeForm(formId);
    },

    async removeForm(formId) {
      await eventLog.removeWhere((e) => e.formId === formId);
      for (const k of sessionCounts.keys()) if (k.startsWith(`${formId}:`)) sessionCounts.delete(k);
    },

    // Удалить след одной сессии (вызывается при удалении тестового ответа).
    async removeSession(formId, sessionId) {
      await eventLog.removeWhere((e) => e.formId === formId && e.sessionId === sessionId);
      sessionCounts.delete(key(formId, sessionId));
    },
  };
}

function isElapsed(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_ELAPSED_MS;
}
