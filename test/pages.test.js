import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

describe('Страницы и статика', () => {
  let srv;

  before(async () => {
    srv = await startTestServer();
  });
  after(() => srv.stop());

  async function get(url) {
    const res = await fetch(srv.baseUrl + url, { redirect: 'manual' });
    return { res, text: await res.text() };
  }

  test('корень перенаправляет в админку', async () => {
    const { res } = await get('/');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/admin');
  });

  test('список форм и конструктор отдаются как HTML', async () => {
    for (const url of ['/admin', '/admin/forms/any-id']) {
      const { res, text } = await get(url);
      assert.equal(res.status, 200, url);
      assert.match(res.headers.get('content-type'), /text\/html/);
      assert.match(text, /<html lang="ru">/);
    }
  });

  test('скрипты и стили админки доступны', async () => {
    for (const url of [
      '/static/js/admin/list.js',
      '/static/js/admin/builder.js',
      '/static/js/dom.js',
      '/static/css/admin.css',
    ]) {
      const { res } = await get(url);
      assert.equal(res.status, 200, url);
    }
  });

  test('неизвестная страница → 404', async () => {
    const { res, text } = await get('/no-such-page');
    assert.equal(res.status, 404);
    assert.match(text, /Страница не найдена/);
  });

  test('заголовки безопасности на всех ответах', async () => {
    for (const url of ['/admin', '/api/forms', '/static/css/base.css']) {
      const { res } = await get(url);
      assert.match(res.headers.get('content-security-policy'), /default-src 'self'/, url);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url);
      assert.equal(res.headers.get('x-powered-by'), null, url);
    }
  });
});
