// Заголовки безопасности для всех ответов сервера.
//
// Главный из них — Content-Security-Policy: браузер будет выполнять скрипты
// и загружать стили только с нашего же сервера. Даже если в текст вопроса
// или ответа кто-то вставит <script>, браузер его не запустит.
// Это второй рубеж защиты: первый — интерфейс выводит пользовательский текст
// только как текст, а не как HTML.

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  // Браузер не должен «угадывать» тип файла по содержимому.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Наши страницы нельзя встроить в чужой сайт (защита от кликджекинга в старых браузерах).
  res.setHeader('X-Frame-Options', 'DENY');
  // При переходе на другой сайт не передаём ему адрес страницы: в нём может быть ссылка на форму.
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
}
