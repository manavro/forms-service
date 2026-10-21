// Расчёт аналитики формы по журналу событий.
//
// Что такое «сессия»: одно открытие формы в браузере. У неё случайный номер,
// который живёт только в этой вкладке, — никаких cookie и слежки между визитами.
//
// События сессии (их присылает страница формы, кроме submit):
//   view  — открыл форму
//   focus — перешёл к полю (fieldId)
//   fill  — впервые что-то ввёл или выбрал в поле (fieldId)
//   error — увидел ошибку в поле (fieldId)
//   leave — ушёл со страницы или свернул вкладку
//   submit — ответ сохранён (пишет сервер, когда принимает ответ)
// У каждого события есть t — миллисекунды с момента открытия страницы —
// и at — время получения сервером.
//
// Что считаем:
//   Открыли    — все сессии.
//   Начали     — сессии, где студент перешёл хотя бы к одному полю.
//   Отправили  — сессии с submit.
//   Бросили    — начали, не отправили и ничего не делали дольше ABANDON_AFTER_MS.
//                Тех, кто активен недавно, считаем «заполняют сейчас» — может, ещё отправят.
//   Дошли до вопроса — сессии, где студент добрался до этого вопроса или дальше по форме.
//   Ушли на вопросе — для брошенных сессий: вопрос, с которым студент работал последним.
//   Время на вопросе — медиана по сессиям: от перехода к полю до перехода к следующему
//                полю, ухода со страницы или отправки. Медиана, а не среднее, чтобы
//                одна забытая открытой вкладка не испортила цифру.

import { countLabel } from '../shared/plural.js';

export const ABANDON_AFTER_MS = 30 * 60 * 1000;
// Отрезок дольше получаса — это не «думал над вопросом», а ушёл пить чай. Не учитываем.
const SEGMENT_CAP_MS = 30 * 60 * 1000;
// Выводы делаем только при минимальном объёме данных, иначе это гадание.
const MIN_VIEWS_FOR_INSIGHTS = 5;
const MIN_ABANDONED_FOR_DROP_INSIGHT = 3;
const MIN_REACHED_FOR_FIELD_INSIGHT = 5;

const FIELD_EVENTS = new Set(['focus', 'fill', 'error']);
const SEGMENT_BOUNDARIES = new Set(['focus', 'leave', 'submit']);

// form — форма с текущими полями; events — события этой формы;
// now — текущее время (мс); since — учитывать события не раньше этого момента (мс) или null.
export function computeAnalytics(form, events, { now = Date.now(), since = null } = {}) {
  const fieldIndex = new Map(form.fields.map((field, i) => [field.id, i]));

  const sessions = new Map();
  for (const event of events) {
    if (since !== null && Date.parse(event.at) < since) continue;
    if (!sessions.has(event.sessionId)) sessions.set(event.sessionId, []);
    sessions.get(event.sessionId).push(event);
  }

  const fields = form.fields.map((field) => ({
    fieldId: field.id,
    label: field.label,
    type: field.type,
    required: field.required,
    reached: 0,
    droppedHere: 0,
    errorSessions: 0,
    durations: [],
  }));
  const totals = { views: 0, started: 0, submitted: 0, abandoned: 0, inProgress: 0 };

  for (const sessionEvents of sessions.values()) {
    // Порядок внутри сессии — по t (время на стороне студента), события без t — в конце.
    const ordered = [...sessionEvents].sort(
      (a, b) => (a.t ?? Infinity) - (b.t ?? Infinity) || a.at.localeCompare(b.at),
    );
    const submitted = ordered.some((e) => e.type === 'submit');
    const touched = ordered.filter((e) => FIELD_EVENTS.has(e.type) && fieldIndex.has(e.fieldId));
    const started = touched.length > 0 || submitted;
    const lastActivity = Math.max(...ordered.map((e) => Date.parse(e.at)));

    totals.views++;
    if (started) totals.started++;

    // Докуда дошёл по форме. Отправивший прошёл её целиком.
    const furthest = submitted ? fields.length - 1 : Math.max(-1, ...touched.map((e) => fieldIndex.get(e.fieldId)));
    for (let i = 0; i <= furthest; i++) fields[i].reached++;

    const fieldsWithErrors = new Set(touched.filter((e) => e.type === 'error').map((e) => e.fieldId));
    for (const fieldId of fieldsWithErrors) fields[fieldIndex.get(fieldId)].errorSessions++;

    for (const [fieldId, duration] of fieldDurations(ordered, fieldIndex)) {
      fields[fieldIndex.get(fieldId)].durations.push(duration);
    }

    if (submitted) {
      totals.submitted++;
    } else if (started) {
      if (now - lastActivity > ABANDON_AFTER_MS) {
        totals.abandoned++;
        const last = touched.at(-1);
        if (last) fields[fieldIndex.get(last.fieldId)].droppedHere++;
      } else {
        totals.inProgress++;
      }
    }
  }

  const fieldResults = fields.map(({ durations, ...rest }) => ({
    ...rest,
    medianSeconds: durations.length > 0 ? Math.round(median(durations) / 1000) : null,
    timedSessions: durations.length,
  }));

  return {
    totals,
    funnel: [
      { key: 'view', label: 'Открыли форму', count: totals.views },
      { key: 'start', label: 'Начали заполнять', count: totals.started },
      { key: 'submit', label: 'Отправили ответ', count: totals.submitted },
    ],
    fields: fieldResults,
    insights: buildInsights(totals, fieldResults),
  };
}

// Суммарное время на каждом поле в одной сессии (поле → мс).
function fieldDurations(ordered, fieldIndex) {
  const durations = new Map();
  let current = null; // последнее событие focus, отрезок которого ещё не закрыт
  for (const event of ordered) {
    if (!SEGMENT_BOUNDARIES.has(event.type)) continue;
    if (current && Number.isFinite(current.t) && Number.isFinite(event.t)) {
      const duration = event.t - current.t;
      if (duration > 0 && duration <= SEGMENT_CAP_MS) {
        durations.set(current.fieldId, (durations.get(current.fieldId) ?? 0) + duration);
      }
    }
    current = event.type === 'focus' && fieldIndex.has(event.fieldId) ? event : null;
  }
  return durations;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const percent = (part, whole) => `${Math.round((part / whole) * 100)}%`;
const quoted = (label) => `«${label || 'Без названия'}»`;

// Подсказки менеджеру: что в форме, судя по данным, мешает студентам.
function buildInsights(totals, fields) {
  if (totals.views < MIN_VIEWS_FOR_INSIGHTS) {
    return [
      {
        level: 'info',
        text:
          `Данных пока мало для выводов: форму открыли ${countLabel(totals.views, ['раз', 'раза', 'раз'])}. ` +
          `Подсказки появятся, когда открытий будет хотя бы ${MIN_VIEWS_FOR_INSIGHTS}.`,
      },
    ];
  }

  const insights = [];

  const notStarted = totals.views - totals.started;
  if (notStarted / totals.views >= 0.5) {
    insights.push({
      level: 'warning',
      text:
        `${percent(notStarted, totals.views)} открывших ушли, даже не начав заполнять. ` +
        'Проверьте название и описание: понятно ли, зачем эта форма и сколько времени она займёт.',
    });
  }

  if (totals.abandoned >= MIN_ABANDONED_FOR_DROP_INSIGHT) {
    const top = fields.reduce((best, f) => (f.droppedHere > (best?.droppedHere ?? 0) ? f : best), null);
    if (top && top.droppedHere / totals.abandoned >= 0.3) {
      insights.push({
        level: 'warning',
        fieldId: top.fieldId,
        text:
          `Чаще всего форму бросают на вопросе ${quoted(top.label)}: ${top.droppedHere} из ${totals.abandoned} брошенных. ` +
          'Возможно, вопрос сложный, слишком личный или кажется лишним — подумайте, нужен ли он и должен ли быть обязательным.',
      });
    }
  }

  const errorProne = fields
    .filter((f) => f.reached >= MIN_REACHED_FOR_FIELD_INSIGHT && f.errorSessions / f.reached >= 0.2)
    .sort((a, b) => b.errorSessions / b.reached - a.errorSessions / a.reached)
    .slice(0, 2);
  for (const f of errorProne) {
    insights.push({
      level: 'warning',
      fieldId: f.fieldId,
      text:
        `В вопросе ${quoted(f.label)} ошибку увидели ${percent(f.errorSessions, f.reached)} дошедших до него. ` +
        'Уточните подсказку или добавьте пример правильного ответа.',
    });
  }

  const slow = fields.filter(
    (f) => f.type !== 'long_text' && f.timedSessions >= MIN_REACHED_FOR_FIELD_INSIGHT && f.medianSeconds > 60,
  );
  for (const f of slow) {
    insights.push({
      level: 'info',
      fieldId: f.fieldId,
      text: `На вопрос ${quoted(f.label)} обычно уходит больше минуты. Возможно, формулировка непонятна или ответ приходится искать.`,
    });
  }

  if (insights.length === 0) {
    insights.push({
      level: 'success',
      text:
        totals.started > 0 && totals.submitted / totals.started >= 0.8
          ? 'Явных проблем не видно: большинство начавших доходят до отправки.'
          : 'Явных узких мест не видно: студенты уходят на разных вопросах, без одного «проблемного».',
    });
  }
  return insights;
}
