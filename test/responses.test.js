import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { csvFileName, escapeCell } from '../src/responses/csv.js';
import { formatAnswer } from '../src/shared/answerFormat.js';
import { startTestServer } from './helpers.js';

describe('formatAnswer', () => {
  test('ответы разных типов превращаются в текст', () => {
    assert.equal(formatAnswer({ type: 'short_text', value: 'Иван' }), 'Иван');
    assert.equal(formatAnswer({ type: 'dropdown', value: { id: 'a', label: '2 курс' } }), '2 курс');
    assert.equal(
      formatAnswer({ type: 'multiple_choice', value: [{ id: 'a', label: 'JS' }, { id: 'b', label: 'CSS' }] }),
      'JS, CSS',
    );
    assert.equal(formatAnswer({ type: 'checkbox', value: true }), 'Да');
    assert.equal(formatAnswer({ type: 'checkbox', value: false }), 'Нет');
    assert.equal(formatAnswer({ type: 'email', value: null }), '');
    assert.equal(formatAnswer(undefined), '');
  });
});

describe('CSV', () => {
  test('ячейки с разделителем, кавычками и переводом строки берутся в кавычки', () => {
    assert.equal(escapeCell('просто текст'), 'просто текст');
    assert.equal(escapeCell('а;б'), '"а;б"');
    assert.equal(escapeCell('он сказал "да"'), '"он сказал ""да"""');
    assert.equal(escapeCell('строка 1\nстрока 2'), '"строка 1\nстрока 2"');
  });

  test('защита от формул: значения, начинающиеся с = + - @, получают апостроф', () => {
    assert.equal(escapeCell('=HYPERLINK("http://evil")'), `"'=HYPERLINK(""http://evil"")"`);
    assert.equal(escapeCell('+7 999 123-45-67'), "'+7 999 123-45-67");
    assert.equal(escapeCell('-1'), "'-1");
    assert.equal(escapeCell('@cmd'), "'@cmd");
    assert.equal(escapeCell('ivan@example.com'), 'ivan@example.com');
  });

  test('имя файла без запрещённых в Windows символов', () => {
    assert.equal(csvFileName('Стажировка: веб/мобильная?'), 'Стажировка веб мобильная — ответы.csv');
    assert.equal(csvFileName('***'), 'Форма — ответы.csv');
  });
});

describe('API ответов', () => {
  let srv;
  let api;
  let form;

  before(async () => {
    srv = await startTestServer();
    api = srv.api;

    form = (
      await api('POST', '/api/forms', {
        title: 'Стажировка; набор "Весна"',
        fields: [
          { id: 'name', type: 'short_text', label: 'ФИО', required: true },
          { id: 'phone', type: 'phone', label: 'Телефон' },
          { id: 'about', type: 'long_text', label: 'О себе' },
          { id: 'course', type: 'dropdown', label: 'Курс', options: [{ id: 'c1', label: '1 курс' }, { id: 'c2', label: '2 курс' }] },
        ],
      })
    ).body.form;
    await api('POST', `/api/forms/${form.id}/publish`);

    const send = (answers) => api('POST', `/api/public/forms/${form.slug}/responses`, { answers });
    await send({ name: 'Первый', phone: '+7 999 111-11-11', about: 'Люблю; точки с запятой\nи переносы', course: 'c1' });
    await send({ name: 'Второй', course: 'c2' });

    // Менеджер удаляет вопрос «О себе», переименовывает «ФИО» и добавляет новый вопрос.
    const { form: current } = (await api('GET', `/api/forms/${form.id}`)).body;
    const fields = current.fields
      .filter((f) => f.id !== 'about')
      .map((f) => (f.id === 'name' ? { ...f, label: 'Фамилия и имя' } : f));
    fields.push({ id: 'city', type: 'short_text', label: 'Город' });
    await api('PUT', `/api/forms/${form.id}`, { ...current, fields });

    await send({ name: 'Третий', city: 'Казань' });
  });
  after(() => srv.stop());

  test('таблица: текущие вопросы, затем удалённые; свежие ответы сверху', async () => {
    const { status, body } = await api('GET', `/api/forms/${form.id}/responses`);
    assert.equal(status, 200);
    assert.equal(body.form.title, 'Стажировка; набор "Весна"');

    assert.deepEqual(
      body.columns.map((c) => [c.fieldId, c.label, c.deleted]),
      [
        ['name', 'Фамилия и имя', false],
        ['phone', 'Телефон', false],
        ['course', 'Курс', false],
        ['city', 'Город', false],
        ['about', 'О себе', true],
      ],
    );
    assert.deepEqual(
      body.rows.map((r) => [r.number, r.answers.name.value]),
      [
        [3, 'Третий'],
        [2, 'Второй'],
        [1, 'Первый'],
      ],
    );
    // В старом ответе остался текст вопроса на момент отправки.
    assert.equal(body.rows[2].answers.name.label, 'ФИО');
    // На новый вопрос старые ответы не отвечали.
    assert.equal(body.rows[2].answers.city, undefined);
  });

  test('CSV для Excel: BOM, «;», порядок отправки, экранирование', async () => {
    const res = await fetch(`${srv.baseUrl}/api/forms/${form.id}/responses/export`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv; charset=utf-8/);
    assert.match(res.headers.get('content-disposition'), /^attachment; filename="responses\.csv"; filename\*=UTF-8''/);
    assert.match(
      decodeURIComponent(res.headers.get('content-disposition').split("''")[1]),
      /^Стажировка; набор Весна — ответы\.csv$/,
    );

    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'файл начинается с BOM');

    const text = new TextDecoder().decode(bytes);
    const lines = text.split('\r\n');
    assert.equal(lines[0], '№;Дата отправки;Фамилия и имя;Телефон;Курс;Город;О себе (вопрос удалён)');
    // Перенос строки внутри ответа остаётся внутри ячейки в кавычках; строки файла разделены \r\n.
    assert.match(lines[1], /^1;\d\d\.\d\d\.\d{4}, \d\d:\d\d;Первый;'\+7 999 111-11-11;1 курс;;"Люблю; точки с запятой\nи переносы"$/);
    assert.match(lines[2], /^2;.*;Второй;;2 курс;;$/);
    assert.match(lines[3], /^3;.*;Третий;;;Казань;$/);
    assert.equal(lines[4], '');
    assert.equal(lines.length, 5);
  });

  test('удаление одного ответа', async () => {
    const { body } = await api('GET', `/api/forms/${form.id}/responses`);
    const second = body.rows.find((r) => r.number === 2);

    assert.equal((await api('DELETE', `/api/forms/${form.id}/responses/${second.id}`)).status, 204);
    assert.equal((await api('DELETE', `/api/forms/${form.id}/responses/${second.id}`)).status, 404);

    const after = (await api('GET', `/api/forms/${form.id}/responses`)).body;
    assert.deepEqual(
      after.rows.map((r) => [r.number, r.answers.name.value]),
      [
        [2, 'Третий'],
        [1, 'Первый'],
      ],
    );
    assert.equal((await api('GET', `/api/forms/${form.id}`)).body.responseCount, 2);
  });

  test('ответ можно удалить только через его форму', async () => {
    const other = (await api('POST', '/api/forms', { title: 'Другая' })).body.form;
    const { body } = await api('GET', `/api/forms/${form.id}/responses`);
    const status = (await api('DELETE', `/api/forms/${other.id}/responses/${body.rows[0].id}`)).status;
    assert.equal(status, 404);
  });

  test('для несуществующей формы — 404', async () => {
    assert.equal((await api('GET', '/api/forms/nope/responses')).status, 404);
    assert.equal((await fetch(`${srv.baseUrl}/api/forms/nope/responses/export`)).status, 404);
  });

  test('страница ответов отдаётся как HTML', async () => {
    const res = await fetch(`${srv.baseUrl}/admin/forms/${form.id}/responses`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /responses\.js/);
  });
});
