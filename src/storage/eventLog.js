// Журнал событий аналитики: data/events.jsonl.
//
// Почему отдельный файл, а не db.json:
// - Событий намного больше, чем ответов: каждый переход между полями — событие.
//   Переписывать весь db.json на каждое такое событие было бы расточительно.
// - Формат JSON Lines: одна строка — одно событие. Новые события дописываются
//   в конец файла, старые не трогаются. Дописать строку — быстро и дёшево.
// - Если сервер упадёт посреди записи, пострадать может только последняя
//   строка. При чтении такие строки пропускаются, остальные данные целы.
// - Ответы студентов — самое ценное — не делят файл с потоком событий.
//
// Файл целиком переписывается (атомарно) только при удалении: когда удаляют
// форму, ответ или сбрасывают аналитику.
//
// Ограничение: все события держатся в памяти. Для MVP это нормально, а при
// больших объёмах журнал стоит перенести в базу данных.

import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './atomicWrite.js';

export class EventLog {
  #filePath;
  #events;
  #queue = Promise.resolve();

  constructor(filePath, events) {
    this.#filePath = filePath;
    this.#events = events;
  }

  static async open(filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    let text = '';
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    const events = [];
    let skipped = 0;
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      try {
        events.push(Object.freeze(JSON.parse(line)));
      } catch {
        skipped++;
      }
    }
    if (skipped > 0) {
      console.warn(`В ${filePath} пропущено повреждённых строк: ${skipped} (например, после аварийной остановки).`);
    }
    // Если последняя строка оборвана, закрываем её переводом строки —
    // иначе следующее событие приклеится к обрывку и тоже станет нечитаемым.
    if (text !== '' && !text.endsWith('\n')) await fs.appendFile(filePath, '\n', 'utf8');
    return new EventLog(filePath, events);
  }

  // Все события только для чтения.
  get events() {
    return this.#events;
  }

  // Дописать события в конец журнала.
  append(records) {
    if (records.length === 0) return Promise.resolve();
    return this.#enqueue(async () => {
      const frozen = records.map((r) => Object.freeze({ ...r }));
      await fs.appendFile(this.#filePath, frozen.map((r) => JSON.stringify(r) + '\n').join(''), 'utf8');
      this.#events.push(...frozen);
    });
  }

  // Удалить события, подходящие под условие. Возвращает, сколько удалено.
  removeWhere(predicate) {
    return this.#enqueue(async () => {
      const kept = this.#events.filter((e) => !predicate(e));
      const removed = this.#events.length - kept.length;
      if (removed > 0) {
        await writeFileAtomic(this.#filePath, kept.map((e) => JSON.stringify(e) + '\n').join(''));
        this.#events = kept;
      }
      return removed;
    });
  }

  flush() {
    return this.#queue;
  }

  // Операции с файлом идут строго по очереди, как и в JsonStore.
  #enqueue(operation) {
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => {});
    return result;
  }
}
