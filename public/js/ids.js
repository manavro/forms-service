// Случайные id для новых полей и вариантов ответа, созданных в браузере.
// Сервер принимает такие id (буквы, цифры, «-», «_») и сохраняет их,
// поэтому у элемента с самого создания есть постоянный ключ.
// crypto.getRandomValues доступен везде, в отличие от crypto.randomUUID,
// который работает только на localhost и по HTTPS.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function newId(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % 64]).join('');
}
