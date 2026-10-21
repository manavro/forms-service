// Настройки сервиса из переменных окружения.

export const DEFAULT_PORT = 3000;

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
