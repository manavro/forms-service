import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { EventLog } from '../src/storage/eventLog.js';
import { makeTempDir } from './helpers.js';

describe('EventLog', () => {
  let temp;
  let file;

  beforeEach(async () => {
    temp = await makeTempDir();
    file = path.join(temp.dir, 'events.jsonl');
  });
  afterEach(() => temp.cleanup());

  test('пустой журнал, если файла нет', async () => {
    const log = await EventLog.open(file);
    assert.deepEqual(log.events, []);
  });

  test('события дописываются по строке и переживают перезапуск', async () => {
    const log = await EventLog.open(file);
    await log.append([{ type: 'view', n: 1 }]);
    await log.append([{ type: 'focus', n: 2 }, { type: 'leave', n: 3 }]);

    const text = await fs.readFile(file, 'utf8');
    assert.equal(text.split('\n').filter(Boolean).length, 3);

    const reopened = await EventLog.open(file);
    assert.deepEqual(
      reopened.events.map((e) => e.n),
      [1, 2, 3],
    );
  });

  test('повреждённые строки пропускаются, оборванная последняя строка закрывается', async () => {
    await fs.writeFile(file, '{"n":1}\nмусор\n{"n":2}\n{"n":3, "обры');
    const log = await EventLog.open(file);
    assert.deepEqual(
      log.events.map((e) => e.n),
      [1, 2],
    );

    // Новое событие не приклеилось к обрывку и читается после перезапуска.
    await log.append([{ n: 4 }]);
    const reopened = await EventLog.open(file);
    assert.deepEqual(
      reopened.events.map((e) => e.n),
      [1, 2, 4],
    );
  });

  test('удаление по условию переписывает файл', async () => {
    const log = await EventLog.open(file);
    await log.append([{ form: 'a' }, { form: 'b' }, { form: 'a' }]);
    assert.equal(await log.removeWhere((e) => e.form === 'a'), 2);
    assert.deepEqual(log.events, [{ form: 'b' }]);
    assert.deepEqual((await EventLog.open(file)).events, [{ form: 'b' }]);
  });

  test('одновременные записи не теряются', async () => {
    const log = await EventLog.open(file);
    await Promise.all(Array.from({ length: 30 }, (_, i) => log.append([{ n: i }])));
    assert.equal((await EventLog.open(file)).events.length, 30);
  });
});
