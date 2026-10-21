// Хранилище «один JSON-файл».
//
// Как это работает:
// - При запуске файл читается целиком в память. Чтение данных — из памяти, это быстро.
// - Любое изменение идёт через update(). Изменения выполняются строго по очереди,
//   поэтому два одновременных запроса не перетрут друг друга.
// - Изменение применяется к копии данных. Копия пишется на диск атомарно
//   (временный файл → переименование). Только после успешной записи копия
//   становится текущими данными. Итог: изменение либо сохранилось целиком, либо его нет.
// - Текущие данные «заморожены» (Object.freeze): случайно изменить их в обход
//   update() не получится — код упадёт с ошибкой, а не испортит данные молча.

import fs from 'node:fs/promises';
import path from 'node:path';

export class JsonStore {
  #filePath;
  #state;
  #queue = Promise.resolve();

  constructor(filePath, state) {
    this.#filePath = filePath;
    this.#state = deepFreeze(state);
  }

  // Открывает файл. Если файла нет — создаёт его с начальными данными.
  // Если файл повреждён — останавливаемся с понятной ошибкой и файл не трогаем:
  // молча начать с пустыми данными значило бы потерять всё, что там было.
  static async open(filePath, initialState) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    let text;
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const state = structuredClone(initialState);
      await writeFileAtomic(filePath, serialize(state));
      return new JsonStore(filePath, state);
    }

    let state;
    try {
      // Блокнот Windows умеет дописывать в начало файла невидимый символ BOM — убираем его.
      state = JSON.parse(text.replace(/^﻿/, ''));
    } catch {
      throw new Error(
        `Файл данных ${filePath} повреждён: это не корректный JSON. ` +
          'Исправьте файл или удалите его, чтобы начать с пустыми данными.',
      );
    }
    return new JsonStore(filePath, state);
  }

  // Текущие данные только для чтения.
  get state() {
    return this.#state;
  }

  // Выполняет изменение данных. mutate получает изменяемую копию данных
  // и может вернуть результат — он вернётся из update().
  // Если mutate бросит ошибку, ничего не сохранится.
  update(mutate) {
    const run = async () => {
      const draft = structuredClone(this.#state);
      const result = await mutate(draft);
      await writeFileAtomic(this.#filePath, serialize(draft));
      this.#state = deepFreeze(draft);
      return result;
    };

    const operation = this.#queue.then(run);
    // Ошибка одной операции не должна ломать очередь для следующих.
    this.#queue = operation.catch(() => {});
    return operation;
  }

  // Дождаться завершения всех начатых записей (нужно при остановке сервера).
  flush() {
    return this.#queue;
  }
}

function serialize(state) {
  return JSON.stringify(state, null, 2) + '\n';
}

// Атомарная запись: пишем во временный файл, сбрасываем его на диск,
// затем переименовываем поверх основного. Переименование в пределах одной
// папки выполняется операционной системой целиком, поэтому основной файл
// всегда либо старый, либо новый — но не обрезанный посередине.
async function writeFileAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  const handle = await fs.open(tmpPath, 'w');
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await renameWithRetry(tmpPath, filePath);
}

// На Windows антивирус или индексатор могут на мгновение занять файл,
// и переименование падает с EPERM/EBUSY. В этом случае пробуем ещё несколько раз.
async function renameWithRetry(from, to) {
  const attempts = 10;
  for (let i = 1; ; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const retriable = ['EPERM', 'EACCES', 'EBUSY'].includes(err.code);
      if (!retriable || i === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 20 * i));
    }
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
