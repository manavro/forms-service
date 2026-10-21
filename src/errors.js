// Ошибки, которые нужно показать клиенту с конкретным HTTP-статусом.
// Всё остальное считается непредвиденной ошибкой и превращается в 500.

export class HttpError extends Error {
  // extra — дополнительные данные для клиента, попадут в тело ответа рядом с error.
  constructor(status, message, { details, extra } = {}) {
    super(message);
    this.status = status;
    this.details = details;
    this.extra = extra;
  }
}

// details — список ошибок по конкретным полям: [{ path: 'fields[0].label', message: '...' }].
// По path интерфейс сможет подсветить нужное место.
export class ValidationError extends HttpError {
  constructor(details, message = 'Проверьте введённые данные') {
    super(400, message, { details });
  }
}

export const notFound = (message = 'Не найдено') => new HttpError(404, message);
export const conflict = (message) => new HttpError(409, message);
// 410 Gone — ресурс был, но больше недоступен (например, приём ответов закрыт).
export const gone = (message, extra) => new HttpError(410, message, { extra });
