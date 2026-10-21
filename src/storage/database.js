// Основной файл данных сервиса: data/db.json.
//
// Внутри:
//   schemaVersion — версия структуры файла. Если структура когда-нибудь изменится,
//                   по этому номеру можно будет понять, что старый файл нужно обновить.
//   forms         — формы, которые собрал менеджер.
//   responses     — ответы студентов.

import path from 'node:path';
import { JsonStore } from './jsonStore.js';

export const SCHEMA_VERSION = 1;

const EMPTY_DATABASE = {
  schemaVersion: SCHEMA_VERSION,
  forms: [],
  responses: [],
};

export async function openDatabase(dataDir) {
  const filePath = path.join(dataDir, 'db.json');
  const store = await JsonStore.open(filePath, EMPTY_DATABASE);

  const { state } = store;
  const looksValid =
    state && state.schemaVersion === SCHEMA_VERSION && Array.isArray(state.forms) && Array.isArray(state.responses);
  if (!looksValid) {
    throw new Error(
      `Файл данных ${filePath} имеет неожиданную структуру (ожидается schemaVersion ${SCHEMA_VERSION}). ` +
        'Исправьте файл или удалите его, чтобы начать с пустыми данными.',
    );
  }
  return store;
}
