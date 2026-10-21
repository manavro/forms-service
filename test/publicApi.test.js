import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

const formInput = {
  title: 'Летняя стажировка',
  description: 'Отклик на стажировку',
  fields: [
    { id: 'name', type: 'short_text', label: 'ФИО', required: true },
    { id: 'mail', type: 'email', label: 'Почта', required: true },
    {
      id: 'course',
      type: 'dropdown',
      label: 'Курс',
      options: [
        { id: 'c1', label: '1 курс' },
        { id: 'c2', label: '2 курс' },
      ],
    },
    {
      id: 'skills',
      type: 'multiple_choice',
      label: 'Навыки',
      options: [
        { id: 'js', label: 'JavaScript' },
        { id: 'css', label: 'CSS' },
      ],
    },
    { id: 'consent', type: 'checkbox', label: 'Согласен на обработку данных', required: true },
  ],
};

const goodAnswers = {
  name: 'Иван Петров',
  mail: 'ivan@example.com',
  course: 'c2',
  skills: ['css', 'js'],
  consent: true,
};

describe('Публичное API', () => {
  let srv;
  let api;

  before(async () => {
    srv = await startTestServer();
    api = srv.api;
  });
  after(() => srv.stop());

  async function createForm({ publish = true } = {}) {
    const { form } = (await api('POST', '/api/forms', formInput)).body;
    if (publish) await api('POST', `/api/forms/${form.id}/publish`);
    return form;
  }

  const responsesOf = (formId) => srv.db.state.responses.filter((r) => r.formId === formId);

  test('опубликованная форма отдаётся без служебных данных', async () => {
    const form = await createForm();
    const { status, body } = await api('GET', `/api/public/forms/${form.slug}`);
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body.form).sort(), ['description', 'fields', 'slug', 'title']);
    assert.equal(body.form.fields.length, 5);
  });

  test('черновик и несуществующая ссылка → 404', async () => {
    const draft = await createForm({ publish: false });
    assert.equal((await api('GET', `/api/public/forms/${draft.slug}`)).status, 404);
    assert.equal((await api('GET', '/api/public/forms/no-such-slug')).status, 404);
    const post = await api('POST', `/api/public/forms/${draft.slug}/responses`, { answers: goodAnswers });
    assert.equal(post.status, 404);
  });

  test('закрытая форма → 410 с названием формы, ответы не принимаются', async () => {
    const form = await createForm();
    await api('POST', `/api/forms/${form.id}/close`);

    const get = await api('GET', `/api/public/forms/${form.slug}`);
    assert.equal(get.status, 410);
    assert.equal(get.body.title, formInput.title);

    const post = await api('POST', `/api/public/forms/${form.slug}/responses`, { answers: goodAnswers });
    assert.equal(post.status, 410);
    assert.equal(responsesOf(form.id).length, 0);
  });

  test('корректный ответ сохраняется вместе с текстами вопросов', async () => {
    const form = await createForm();
    const { status } = await api('POST', `/api/public/forms/${form.slug}/responses`, {
      answers: { ...goodAnswers, name: '  Иван Петров  ' },
    });
    assert.equal(status, 201);

    const [response] = responsesOf(form.id);
    assert.ok(response.id);
    assert.ok(response.submittedAt);
    assert.equal(response.formVersion, 1);
    assert.deepEqual(response.answers, [
      { fieldId: 'name', type: 'short_text', label: 'ФИО', value: 'Иван Петров' },
      { fieldId: 'mail', type: 'email', label: 'Почта', value: 'ivan@example.com' },
      { fieldId: 'course', type: 'dropdown', label: 'Курс', value: { id: 'c2', label: '2 курс' } },
      {
        fieldId: 'skills',
        type: 'multiple_choice',
        label: 'Навыки',
        value: [
          { id: 'js', label: 'JavaScript' },
          { id: 'css', label: 'CSS' },
        ],
      },
      { fieldId: 'consent', type: 'checkbox', label: 'Согласен на обработку данных', value: true },
    ]);

    const list = await api('GET', '/api/forms');
    assert.equal(list.body.forms.find((f) => f.id === form.id).responseCount, 1);
  });

  test('ошибки в ответах → 400 с id полей, ничего не сохраняется', async () => {
    const form = await createForm();
    const { status, body } = await api('POST', `/api/public/forms/${form.slug}/responses`, {
      answers: { name: '', mail: 'не почта', course: 'чужой', consent: false },
    });
    assert.equal(status, 400);
    assert.deepEqual(
      body.details.map((d) => d.path),
      ['name', 'mail', 'course', 'consent'],
    );
    assert.equal(responsesOf(form.id).length, 0);
  });

  test('запрос без ответов → 400 по обязательным полям', async () => {
    const form = await createForm();
    const { status, body } = await api('POST', `/api/public/forms/${form.slug}/responses`, {});
    assert.equal(status, 400);
    assert.deepEqual(
      body.details.map((d) => d.path),
      ['name', 'mail', 'consent'],
    );
  });

  test('повторная отправка с тем же submissionId не создаёт дубль', async () => {
    const form = await createForm();
    const body = { answers: goodAnswers, submissionId: 'attempt-1' };
    assert.equal((await api('POST', `/api/public/forms/${form.slug}/responses`, body)).status, 201);
    assert.equal((await api('POST', `/api/public/forms/${form.slug}/responses`, body)).status, 201);
    assert.equal(responsesOf(form.id).length, 1);

    await api('POST', `/api/public/forms/${form.slug}/responses`, { ...body, submissionId: 'attempt-2' });
    assert.equal(responsesOf(form.id).length, 2);
  });

  test('ловушка для ботов: заполненное скрытое поле — «успех» без сохранения', async () => {
    const form = await createForm();
    const { status } = await api('POST', `/api/public/forms/${form.slug}/responses`, {
      answers: goodAnswers,
      website: 'http://spam.example',
    });
    assert.equal(status, 201);
    assert.equal(responsesOf(form.id).length, 0);
  });

  test('старые ответы не меняются, когда менеджер правит форму', async () => {
    const form = await createForm();
    await api('POST', `/api/public/forms/${form.slug}/responses`, { answers: goodAnswers });

    const { form: current } = (await api('GET', `/api/forms/${form.id}`)).body;
    const renamed = current.fields.map((f) => (f.id === 'name' ? { ...f, label: 'Фамилия и имя' } : f));
    await api('PUT', `/api/forms/${form.id}`, { ...current, fields: renamed.filter((f) => f.id !== 'skills') });

    const [response] = responsesOf(form.id);
    assert.equal(response.answers[0].label, 'ФИО');
    assert.ok(response.answers.some((a) => a.fieldId === 'skills'));
  });

  test('удаление формы удаляет и её ответы', async () => {
    const form = await createForm();
    await api('POST', `/api/public/forms/${form.slug}/responses`, { answers: goodAnswers });
    await api('DELETE', `/api/forms/${form.id}`);
    assert.equal(responsesOf(form.id).length, 0);
  });

  test('ответы API запрещено кешировать', async () => {
    const form = await createForm();
    for (const url of [`/api/public/forms/${form.slug}`, '/api/public/forms/nope', '/api/forms']) {
      const res = await fetch(srv.baseUrl + url);
      assert.equal(res.headers.get('cache-control'), 'no-store', url);
    }
  });

  test('страница формы /f/:slug отдаётся как HTML', async () => {
    const res = await fetch(`${srv.baseUrl}/f/anything`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /page\.js/);
  });
});
