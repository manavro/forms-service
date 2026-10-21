import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ABANDON_AFTER_MS, computeAnalytics } from '../src/analytics/computeAnalytics.js';

const form = {
  fields: [
    { id: 'name', type: 'short_text', label: 'ФИО', required: true },
    { id: 'phone', type: 'phone', label: 'Телефон', required: true },
    { id: 'about', type: 'long_text', label: 'О себе', required: false },
  ],
};

const NOW = Date.parse('2026-10-21T12:00:00Z');
const OLD = new Date(NOW - ABANDON_AFTER_MS - 60_000).toISOString(); // давно — сессия брошена
const RECENT = new Date(NOW - 60_000).toISOString(); // минуту назад — ещё заполняют

// Короткая запись сессии: [тип, поле или null, t в секундах].
function session(id, at, steps) {
  return steps.map(([type, fieldId, seconds]) => ({
    formId: 'f',
    sessionId: id,
    type,
    ...(fieldId ? { fieldId } : {}),
    t: seconds === null ? null : seconds * 1000,
    at,
  }));
}

const events = [
  // A: открыл и сразу ушёл
  ...session('A', OLD, [['view', null, 0]]),
  // B: начал, бросил на ФИО
  ...session('B', OLD, [
    ['view', null, 0],
    ['focus', 'name', 2],
    ['fill', 'name', 3],
    ['leave', null, 12],
  ]),
  // C: дошёл до телефона, увидел ошибку, бросил
  ...session('C', OLD, [
    ['view', null, 0],
    ['focus', 'name', 1],
    ['focus', 'phone', 9],
    ['error', 'phone', 20],
    ['leave', null, 49],
  ]),
  // D: заполнил всё и отправил
  ...session('D', OLD, [
    ['view', null, 0],
    ['focus', 'name', 1],
    ['focus', 'phone', 5],
    ['focus', 'about', 11],
    ['submit', null, 41],
  ]),
  // E: заполняет прямо сейчас
  ...session('E', RECENT, [
    ['view', null, 0],
    ['focus', 'name', 1],
  ]),
];

describe('computeAnalytics', () => {
  const report = computeAnalytics(form, events, { now: NOW });

  test('воронка и итоги', () => {
    assert.deepEqual(report.totals, { views: 5, started: 4, submitted: 1, abandoned: 2, inProgress: 1 });
    assert.deepEqual(
      report.funnel.map((s) => [s.key, s.count]),
      [
        ['view', 5],
        ['start', 4],
        ['submit', 1],
      ],
    );
  });

  test('сколько дошло до каждого вопроса (по самому дальнему вопросу сессии)', () => {
    // name: B, C, D, E; phone: C, D; about: D
    assert.deepEqual(
      report.fields.map((f) => [f.fieldId, f.reached]),
      [
        ['name', 4],
        ['phone', 2],
        ['about', 1],
      ],
    );
  });

  test('на каком вопросе бросили — последний вопрос брошенной сессии', () => {
    assert.deepEqual(
      report.fields.map((f) => [f.fieldId, f.droppedHere]),
      [
        ['name', 1],
        ['phone', 1],
        ['about', 0],
      ],
    );
  });

  test('ошибки считаются по сессиям', () => {
    assert.deepEqual(
      report.fields.map((f) => f.errorSessions),
      [0, 1, 0],
    );
  });

  test('время на вопросе — медиана отрезков от перехода к полю до следующего перехода, ухода или отправки', () => {
    // name: B 2→12 = 10 с, C 1→9 = 8 с, D 1→5 = 4 с, E — отрезок не закрыт → медиана 8
    // phone: C 9→49 = 40 с (ошибка не прерывает отрезок), D 5→11 = 6 с → медиана 23
    // about: D 11→41 = 30 с
    assert.deepEqual(
      report.fields.map((f) => [f.medianSeconds, f.timedSessions]),
      [
        [8, 3],
        [23, 2],
        [30, 1],
      ],
    );
  });

  test('мало данных — честная подсказка вместо выводов', () => {
    const small = computeAnalytics(form, session('X', OLD, [['view', null, 0]]), { now: NOW });
    assert.equal(small.insights.length, 1);
    assert.equal(small.insights[0].level, 'info');
    assert.match(small.insights[0].text, /Данных пока мало.*1 раз\./);
  });

  test('подсказка о вопросе, на котором бросают чаще всего', () => {
    const many = [];
    for (let i = 0; i < 4; i++) {
      many.push(...session(`P${i}`, OLD, [['view', null, 0], ['focus', 'name', 1], ['focus', 'phone', 3], ['leave', null, 30]]));
    }
    many.push(...session('Q', OLD, [['view', null, 0], ['focus', 'name', 1], ['submit', null, 20]]));
    const result = computeAnalytics(form, many, { now: NOW });
    const drop = result.insights.find((i) => i.fieldId === 'phone' && /бросают/.test(i.text));
    assert.ok(drop, 'ожидалась подсказка про «Телефон»');
    assert.match(drop.text, /4 из 4 брошенных/);
  });

  test('подсказка о частых ошибках', () => {
    const many = [];
    for (let i = 0; i < 5; i++) {
      many.push(
        ...session(`R${i}`, OLD, [['view', null, 0], ['focus', 'phone', 1], ['error', 'phone', 2], ['submit', null, 10]]),
      );
    }
    const result = computeAnalytics(form, many, { now: NOW });
    assert.ok(result.insights.some((i) => i.fieldId === 'phone' && /ошибку увидели 100%/.test(i.text)));
  });

  test('события удалённых полей не ломают расчёт', () => {
    const result = computeAnalytics(form, session('Z', OLD, [['view', null, 0], ['focus', 'gone', 1], ['leave', null, 5]]), {
      now: NOW,
    });
    // Перешёл только к несуществующему полю — для текущей формы это «открыл и не начал».
    assert.deepEqual(result.totals, { views: 1, started: 0, submitted: 0, abandoned: 0, inProgress: 0 });
  });

  test('фильтр по периоду', () => {
    const result = computeAnalytics(form, events, { now: NOW, since: NOW - 10 * 60_000 });
    assert.equal(result.totals.views, 1); // только E
  });

  test('отрезки дольше 30 минут не учитываются', () => {
    const result = computeAnalytics(
      form,
      session('L', OLD, [['view', null, 0], ['focus', 'name', 1], ['leave', null, 1 + 31 * 60]]),
      { now: NOW },
    );
    assert.equal(result.fields[0].medianSeconds, null);
  });
});
