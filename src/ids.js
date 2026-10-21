import crypto from 'node:crypto';

// Случайный идентификатор из криптостойкого генератора в формате base64url
// (буквы, цифры, «-» и «_» — безопасно вставлять в URL).
// 9 байт = 72 бита случайности: угадать чужую ссылку перебором нереально.
export function randomId(bytes = 9) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// Формат id, который мы принимаем от клиента (для полей и вариантов ответа).
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
