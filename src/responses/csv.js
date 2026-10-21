// Выгрузка ответов в CSV, который корректно открывается в Excel.
//
// Особенности, о которых легко забыть:
// - Разделитель «;». Excel с русскими региональными настройками ждёт именно его
//   (запятая там — десятичный разделитель), иначе всё окажется в одной колонке.
// - BOM в начале файла. Без него Excel откроет UTF-8 как Windows-1251 и покажет «кракозябры».
// - Переводы строк CRLF — стандарт CSV (RFC 4180).
// - Защита от «CSV-инъекции»: если ответ начинается с = + - @, Excel может посчитать
//   его формулой и выполнить. Студент мог вписать туда что угодно, поэтому такие
//   значения начинаем с апострофа — Excel покажет их как обычный текст.

import { formatAnswer } from '../shared/answerFormat.js';

const SEPARATOR = ';';
const BOM = '﻿';
const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

export function responsesToCsv(table) {
  const header = ['№', 'Дата отправки', ...table.columns.map((c) => (c.deleted ? `${c.label} (вопрос удалён)` : c.label))];

  // В файле — по порядку отправки, как обычно ведут таблицы.
  const rows = [...table.rows].reverse().map((row) => [
    String(row.number),
    dateFormat.format(new Date(row.submittedAt)),
    ...table.columns.map((c) => formatAnswer(row.answers[c.fieldId])),
  ]);

  return BOM + [header, ...rows].map((cells) => cells.map(escapeCell).join(SEPARATOR)).join('\r\n') + '\r\n';
}

export function escapeCell(value) {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[";\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

// Имя файла для скачивания: «Название формы — ответы.csv» без символов,
// которые запрещены в именах файлов Windows.
export function csvFileName(title) {
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${safe || 'Форма'} — ответы.csv`;
}
