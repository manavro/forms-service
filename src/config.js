// Настройки сервиса из переменных окружения.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 3000;
export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));

// Порт берём из PORT. Пустое значение — порт по умолчанию,
// некорректное — ошибка с понятным текстом, а не тихий запуск «куда-то».
export function readPort(value) {
  if (value === undefined || value.trim() === '') return DEFAULT_PORT;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Некорректная переменная PORT="${value}": нужно целое число от 1 до 65535.`);
  }
  return port;
}

// Папка с данными. По умолчанию — data/ в корне проекта.
// Через DATA_DIR можно указать другую (например, тесты используют временную папку).
export function readDataDir(value) {
  if (value === undefined || value.trim() === '') return DEFAULT_DATA_DIR;
  return path.resolve(value);
}
