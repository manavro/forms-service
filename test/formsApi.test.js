import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

const sampleForm = {
  title: 'Стажировка в разработке',
  description: 'Расскажите о себе',
  fields: [
    { type: 'short_text', label: 'ФИО', required: true },
    { type: 'email', label: 'Почта', required: true },
    { type: 'dropdown', label: 'Курс', options: [{ label: '1' }, { label: '2' }, { label: '3' }] },
  ],
};

describe('API форм', () => {
  let srv;
  let api;

  before(async () => {
    srv = await startTestServer();
    api = srv.api;
  });
  after(() => srv.stop());

  // Каждый тест начинает с пустого списка форм.
  beforeEach(async () => {
    const { body } = await api('GET', '/api/forms');
    for (const form of body.forms) await api('DELETE', `/api/forms/${form.id}`);
  });

  test('создание формы: черновик с id, ссылкой и версией 1', async () => {
    const { status, body } = await api('POST', '/api/forms', sampleForm);
    assert.equal(status, 201);
    const { form } = body;
    assert.equal(form.title, sampleForm.title);
    assert.equal(form.status, 'draft');
    assert.equal(form.version, 1);
    assert.match(form.slug, /^[A-Za-z0-9_-]{12}$/);
    assert.notEqual(form.slug, form.id);
    assert.equal(form.fields.length, 3);
  });

  test('форма сохраняется в файл data/db.json', async () => {
    const { body } = await api('POST', '/api/forms', sampleForm);
    await srv.db.flush();
    const saved = JSON.parse(await fs.readFile(path.join(srv.dataDir, 'db.json'), 'utf8'));
    assert.ok(saved.forms.some((f) => f.id === body.form.id));
  });

  test('список форм: краткие данные, свежие сверху', async () => {
    const first = (await api('POST', '/api/forms', { title: 'Первая' })).body.form;
    const second = (await api('POST', '/api/forms', sampleForm)).body.form;
    // Правка первой формы поднимает её наверх.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await api('PUT', `/api/forms/${first.id}`, { title: 'Первая (изменена)', version: 1 });

    const { status, body } = await api('GET', '/api/forms');
    assert.equal(status, 200);
    assert.deepEqual(
      body.forms.map((f) => f.id),
      [first.id, second.id],
    );
    const summary = body.forms[1];
    assert.equal(summary.fieldCount, 3);
    assert.equal(summary.responseCount, 0);
    assert.equal('fields' in summary, false);
  });

  test('получение формы и 404 для несуществующей', async () => {
    const { form } = (await api('POST', '/api/forms', sampleForm)).body;
    const got = await api('GET', `/api/forms/${form.id}`);
    assert.equal(got.status, 200);
    assert.deepEqual(got.body.form, form);
    assert.equal(got.body.responseCount, 0);

    const missing = await api('GET', '/api/forms/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'Форма не найдена');
  });

  test('ошибки проверки возвращаются списком с путями', async () => {
    const { status, body } = await api('POST', '/api/forms', {
      title: '',
      fields: [{ type: 'dropdown', label: 'Курс', options: [] }],
    });
    assert.equal(status, 400);
    assert.deepEqual(
      body.details.map((d) => d.path),
      ['title', 'fields[0].options'],
    );
  });

  test('битый JSON и запрос без тела', async () => {
    assert.equal((await api('POST', '/api/forms', '{oops')).status, 400);
    assert.equal((await api('POST', '/api/forms')).status, 400);
  });

  test('сохранение: версия растёт, id полей сохраняются', async () => {
    const { form } = (await api('POST', '/api/forms', sampleForm)).body;
    const fields = [...form.fields.slice(1), { type: 'long_text', label: 'О себе' }];

    const { status, body } = await api('PUT', `/api/forms/${form.id}`, {
      title: 'Новое название',
      fields,
      version: 1,
    });
    assert.equal(status, 200);
    assert.equal(body.form.version, 2);
    assert.equal(body.form.title, 'Новое название');
    assert.equal(body.form.description, '');
    assert.deepEqual(
      body.form.fields.slice(0, 2).map((f) => f.id),
      form.fields.slice(1).map((f) => f.id),
    );
    assert.ok(body.form.fields[2].id);
  });

  test('сохранение устаревшей версии → 409, изменения не применяются', async () => {
    const { form } = (await api('POST', '/api/forms', sampleForm)).body;
    await api('PUT', `/api/forms/${form.id}`, { title: 'Вкладка 1', version: 1 });

    const stale = await api('PUT', `/api/forms/${form.id}`, { title: 'Вкладка 2', version: 1 });
    assert.equal(stale.status, 409);
    assert.equal((await api('GET', `/api/forms/${form.id}`)).body.form.title, 'Вкладка 1');
  });

  test('сохранение без версии → 400', async () => {
    const { form } = (await api('POST', '/api/forms', sampleForm)).body;
    const { status, body } = await api('PUT', `/api/forms/${form.id}`, { title: 'X' });
    assert.equal(status, 400);
    assert.equal(body.details[0].path, 'version');
  });

  test('через PUT нельзя поменять статус, ссылку или id', async () => {
    const { form } = (await api('POST', '/api/forms', sampleForm)).body;
    const { body } = await api('PUT', `/api/forms/${form.id}`, {
      ...sampleForm,
      version: 1,
      status: 'published',
      slug: 'my-slug',
      id: 'other',
    });
    assert.equal(body.form.status, 'draft');
    assert.equal(body.form.slug, form.slug);
    assert.equal(body.form.id, form.id);
  });

  test('публикация: пустую форму опубликовать нельзя', async () => {
    const { form } = (await api('POST', '/api/forms', { title: 'Пустая' })).body;
    const { status, body } = await api('POST', `/api/forms/${form.id}/publish`);
    assert.equal(status, 400);
    assert.equal(body.details[0].message, 'Добавьте в форму хотя бы одно поле');
  });

  test('жизненный цикл: черновик → опубликована → закрыта → снова опубликована', async () => {
    const { form } = (await api('POST', '/api/forms', sampleForm)).body;

    const closeDraft = await api('POST', `/api/forms/${form.id}/close`);
    assert.equal(closeDraft.status, 409);

    const published = (await api('POST', `/api/forms/${form.id}/publish`)).body.form;
    assert.equal(published.status, 'published');
    assert.ok(published.publishedAt);

    const closed = (await api('POST', `/api/forms/${form.id}/close`)).body.form;
    assert.equal(closed.status, 'closed');
    assert.ok(closed.closedAt);

    const reopened = (await api('POST', `/api/forms/${form.id}/publish`)).body.form;
    assert.equal(reopened.status, 'published');
    assert.equal(reopened.closedAt, null);
  });

  test('у опубликованной формы нельзя удалить все поля', async () => {
    const { form } = (await api('POST', '/api/forms', sampleForm)).body;
    await api('POST', `/api/forms/${form.id}/publish`);
    const { status } = await api('PUT', `/api/forms/${form.id}`, { title: 'X', fields: [], version: form.version });
    assert.equal(status, 400);
  });

  test('копия формы: новый черновик с теми же полями и другой ссылкой', async () => {
    const { form } = (await api('POST', '/api/forms', sampleForm)).body;
    await api('POST', `/api/forms/${form.id}/publish`);

    const { status, body } = await api('POST', `/api/forms/${form.id}/duplicate`);
    assert.equal(status, 201);
    assert.notEqual(body.form.id, form.id);
    assert.notEqual(body.form.slug, form.slug);
    assert.equal(body.form.title, `${sampleForm.title} (копия)`);
    assert.equal(body.form.status, 'draft');
    assert.deepEqual(body.form.fields, form.fields);
  });

  test('удаление формы', async () => {
    const { form } = (await api('POST', '/api/forms', sampleForm)).body;
    assert.equal((await api('DELETE', `/api/forms/${form.id}`)).status, 204);
    assert.equal((await api('GET', `/api/forms/${form.id}`)).status, 404);
    assert.equal((await api('DELETE', `/api/forms/${form.id}`)).status, 404);
  });

  test('неизвестный адрес API → 404 в JSON', async () => {
    const { status, body } = await api('GET', '/api/unknown');
    assert.equal(status, 404);
    assert.equal(body.error, 'Не найдено');
  });

  test('общий модуль типов полей доступен браузеру', async () => {
    const res = await fetch(`${srv.baseUrl}/shared/fieldTypes.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
  });
});
