import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { JsonStore } from '../src/storage/jsonStore.js';
import { openDatabase } from '../src/storage/database.js';
import { makeTempDir } from './helpers.js';

describe('JsonStore', () => {
  let temp;
  let file;

  beforeEach(async () => {
    temp = await makeTempDir();
    file = path.join(temp.dir, 'nested', 'db.json');
  });
  afterEach(() => temp.cleanup());

  test('создаёт файл с начальными данными, если его нет', async () => {
    const store = await JsonStore.open(file, { items: [] });
    assert.deepEqual(store.state, { items: [] });
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { items: [] });
  });

  test('изменения сохраняются на диск и переживают перезапуск', async () => {
    const store = await JsonStore.open(file, { items: [] });
    await store.update((state) => {
      state.items.push('привет');
    });

    const reopened = await JsonStore.open(file, { items: [] });
    assert.deepEqual(reopened.state, { items: ['привет'] });
  });

  test('одновременные изменения выполняются по очереди и не теряются', async () => {
    const store = await JsonStore.open(file, { counter: 0 });
    await Promise.all(
      Array.from({ length: 25 }, () =>
        store.update(async (state) => {
          const current = state.counter;
          // Пауза посреди изменения: без очереди здесь потерялись бы инкременты.
          await new Promise((resolve) => setTimeout(resolve, 1));
          state.counter = current + 1;
        }),
      ),
    );
    assert.equal(store.state.counter, 25);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).counter, 25);
  });

  test('если изменение упало с ошибкой, данные не меняются, а очередь продолжает работать', async () => {
    const store = await JsonStore.open(file, { items: [] });
    await assert.rejects(
      store.update((state) => {
        state.items.push('не должно сохраниться');
        throw new Error('сбой');
      }),
      /сбой/,
    );
    assert.deepEqual(store.state, { items: [] });
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { items: [] });

    await store.update((state) => {
      state.items.push('после сбоя');
    });
    assert.deepEqual(store.state, { items: ['после сбоя'] });
  });

  test('update возвращает результат функции изменения', async () => {
    const store = await JsonStore.open(file, { items: [] });
    const result = await store.update((state) => {
      state.items.push(1);
      return state.items.length;
    });
    assert.equal(result, 1);
  });

  test('текущие данные заморожены: изменить их в обход update нельзя', async () => {
    const store = await JsonStore.open(file, { items: [{ name: 'a' }] });
    assert.throws(() => {
      store.state.items[0].name = 'b';
    }, TypeError);
  });

  test('повреждённый файл не перезаписывается, а вызывает понятную ошибку', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ сломано');
    await assert.rejects(JsonStore.open(file, { items: [] }), /повреждён/);
    assert.equal(await fs.readFile(file, 'utf8'), '{ сломано');
  });

  test('файл с BOM в начале (после Блокнота Windows) читается', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '﻿{"items":[1]}');
    const store = await JsonStore.open(file, { items: [] });
    assert.deepEqual(store.state, { items: [1] });
  });
});

describe('openDatabase', () => {
  let temp;
  beforeEach(async () => {
    temp = await makeTempDir();
  });
  afterEach(() => temp.cleanup());

  test('создаёт пустую базу', async () => {
    const db = await openDatabase(temp.dir);
    assert.deepEqual(db.state, { schemaVersion: 1, forms: [], responses: [] });
  });

  test('отказывается работать с файлом неизвестной структуры', async () => {
    await fs.writeFile(path.join(temp.dir, 'db.json'), '{"something":"else"}');
    await assert.rejects(openDatabase(temp.dir), /неожиданную структуру/);
  });
});
