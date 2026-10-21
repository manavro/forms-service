// Вспомогательные функции для тестов: временная папка данных и запуск приложения
// на случайном свободном порту. Сами тесты — в файлах *.test.js.

import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDatabase, openEventLog } from '../src/storage/database.js';

export async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forms-service-test-'));
  return {
    dir,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

// Поднимает приложение с пустыми данными. Возвращает адрес и функцию api()
// для запросов: api('POST', '/api/forms', { title: '...' }) → { status, body }.
export async function startTestServer() {
  const temp = await makeTempDir();
  const db = await openDatabase(temp.dir);
  const eventLog = await openEventLog(temp.dir);
  const server = http.createServer(createApp({ db, eventLog }));
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://localhost:${server.address().port}`;

  async function api(method, url, body) {
    const res = await fetch(baseUrl + url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    const isJson = res.headers.get('content-type')?.includes('application/json');
    return { status: res.status, body: isJson ? JSON.parse(text) : text };
  }

  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    await db.flush();
    await eventLog.flush();
    await temp.cleanup();
  }

  return { baseUrl, api, db, eventLog, dataDir: temp.dir, stop };
}
