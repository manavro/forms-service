import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

const formInput = {
  title: 'Аналитика',
  fields: [
    { id: 'name', type: 'short_text', label: 'ФИО', required: true },
    { id: 'mail', type: 'email', label: 'Почта', required: true },
  ],
};

describe('API аналитики', () => {
  let srv;
  let api;

  before(async () => {
    srv = await startTestServer();
    api = srv.api;
  });
  after(() => srv.stop());

  async function publishedForm() {
    const { form } = (await api('POST', '/api/forms', formInput)).body;
    await api('POST', `/api/forms/${form.id}/publish`);
    return form;
  }
  const eventsOf = (formId) => srv.eventLog.events.filter((e) => e.formId === formId);
  const sendEvents = (form, sessionId, events) => api('POST', `/api/public/forms/${form.slug}/events`, { sessionId, events });

  test('корректные события записываются со временем сервера', async () => {
    const form = await publishedForm();
    const { status } = await sendEvents(form, 'sess-1', [
      { type: 'view', t: 0 },
      { type: 'focus', fieldId: 'name', t: 1200.4 },
    ]);
    assert.equal(status, 204);

    const saved = eventsOf(form.id);
    assert.equal(saved.length, 2);
    assert.deepEqual(
      { ...saved[1], at: undefined },
      { formId: form.id, sessionId: 'sess-1', type: 'focus', fieldId: 'name', t: 1200, at: undefined },
    );
    assert.ok(Date.parse(saved[1].at));
  });

  test('некорректные события отбрасываются, остальные принимаются', async () => {
    const form = await publishedForm();
    await sendEvents(form, 'sess-2', [
      { type: 'hack', t: 1 },
      { type: 'focus', fieldId: 'нет-такого', t: 1 },
      { type: 'focus', t: 1 },
      { type: 'view', t: -5 },
      { type: 'view', t: 'abc' },
      null,
      { type: 'fill', fieldId: 'mail', t: 10, value: 'секрет' },
    ]);
    const saved = eventsOf(form.id);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].type, 'fill');
    assert.equal('value' in saved[0], false, 'значение ответа не сохраняется');
  });

  test('неверный номер сессии или слишком большая пачка → 400', async () => {
    const form = await publishedForm();
    assert.equal((await sendEvents(form, 'с пробелом', [{ type: 'view', t: 0 }])).status, 400);
    const big = Array.from({ length: 51 }, () => ({ type: 'view', t: 0 }));
    assert.equal((await sendEvents(form, 'ok', big)).status, 400);
  });

  test('черновик → 404, закрытая форма → события молча не принимаются', async () => {
    const { form: draft } = (await api('POST', '/api/forms', formInput)).body;
    assert.equal((await sendEvents(draft, 's', [{ type: 'view', t: 0 }])).status, 404);

    const form = await publishedForm();
    await api('POST', `/api/forms/${form.id}/close`);
    assert.equal((await sendEvents(form, 's', [{ type: 'view', t: 0 }])).status, 204);
    assert.equal(eventsOf(form.id).length, 0);
  });

  test('ограничение числа событий в одной сессии', async () => {
    const form = await publishedForm();
    const batch = Array.from({ length: 50 }, (_, i) => ({ type: 'focus', fieldId: 'name', t: i }));
    for (let i = 0; i < 11; i++) await sendEvents(form, 'flood', batch);
    assert.equal(eventsOf(form.id).length, 500);
  });

  test('отправленный ответ записывает событие submit с временем от открытия формы', async () => {
    const form = await publishedForm();
    await sendEvents(form, 'sess-3', [{ type: 'view', t: 0 }]);
    await api('POST', `/api/public/forms/${form.slug}/responses`, {
      answers: { name: 'Иван', mail: 'ivan@example.com' },
      submissionId: 'sess-3',
      elapsed: 45000,
    });
    const submit = eventsOf(form.id).find((e) => e.type === 'submit');
    assert.deepEqual({ sessionId: submit.sessionId, t: submit.t }, { sessionId: 'sess-3', t: 45000 });

    // Повторная отправка того же ответа не добавляет второй submit.
    await api('POST', `/api/public/forms/${form.slug}/responses`, {
      answers: { name: 'Иван', mail: 'ivan@example.com' },
      submissionId: 'sess-3',
    });
    assert.equal(eventsOf(form.id).filter((e) => e.type === 'submit').length, 1);
  });

  test('отчёт: воронка и статистика по вопросам', async () => {
    const form = await publishedForm();
    await sendEvents(form, 'a', [{ type: 'view', t: 0 }]);
    await sendEvents(form, 'b', [
      { type: 'view', t: 0 },
      { type: 'focus', fieldId: 'name', t: 1000 },
    ]);

    const { status, body } = await api('GET', `/api/forms/${form.id}/analytics`);
    assert.equal(status, 200);
    assert.equal(body.form.id, form.id);
    assert.equal(body.days, null);
    assert.deepEqual(
      body.funnel.map((s) => s.count),
      [2, 1, 0],
    );
    // Сессия b активна прямо сейчас — она «заполняет», а не «бросила».
    assert.equal(body.totals.inProgress, 1);
    assert.equal(body.totals.abandoned, 0);
    assert.deepEqual(
      body.fields.map((f) => [f.fieldId, f.reached]),
      [
        ['name', 1],
        ['mail', 0],
      ],
    );
    assert.ok(Array.isArray(body.insights));
  });

  test('период: только 7 или 30 дней', async () => {
    const form = await publishedForm();
    assert.equal((await api('GET', `/api/forms/${form.id}/analytics?days=7`)).body.days, 7);
    assert.equal((await api('GET', `/api/forms/${form.id}/analytics?days=3`)).status, 400);
    assert.equal((await api('GET', '/api/forms/nope/analytics')).status, 404);
  });

  test('удаление ответа убирает и его сессию из аналитики', async () => {
    const form = await publishedForm();
    await sendEvents(form, 'test-run', [{ type: 'view', t: 0 }]);
    await sendEvents(form, 'real', [{ type: 'view', t: 0 }]);
    await api('POST', `/api/public/forms/${form.slug}/responses`, {
      answers: { name: 'Тест', mail: 'test@example.com' },
      submissionId: 'test-run',
    });

    const { rows } = (await api('GET', `/api/forms/${form.id}/responses`)).body;
    await api('DELETE', `/api/forms/${form.id}/responses/${rows[0].id}`);
    assert.deepEqual(
      [...new Set(eventsOf(form.id).map((e) => e.sessionId))],
      ['real'],
    );
  });

  test('сброс аналитики и удаление формы удаляют её события', async () => {
    const form = await publishedForm();
    await sendEvents(form, 's1', [{ type: 'view', t: 0 }]);
    assert.equal((await api('DELETE', `/api/forms/${form.id}/analytics`)).status, 204);
    assert.equal(eventsOf(form.id).length, 0);

    // После сброса сессия снова может присылать события (счётчик тоже сброшен).
    await sendEvents(form, 's1', [{ type: 'view', t: 0 }]);
    assert.equal(eventsOf(form.id).length, 1);

    await api('DELETE', `/api/forms/${form.id}`);
    assert.equal(eventsOf(form.id).length, 0);
  });

  test('события из sendBeacon (Blob с типом application/json) принимаются', async () => {
    const form = await publishedForm();
    const res = await fetch(`${srv.baseUrl}/api/public/forms/${form.slug}/events`, {
      method: 'POST',
      body: new Blob([JSON.stringify({ sessionId: 'beacon', events: [{ type: 'leave', t: 5 }] })], {
        type: 'application/json',
      }),
    });
    assert.equal(res.status, 204);
    assert.equal(eventsOf(form.id).length, 1);
  });

  test('страница аналитики отдаётся как HTML', async () => {
    const res = await fetch(`${srv.baseUrl}/admin/forms/any/analytics`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /analytics\.js/);
  });
});
