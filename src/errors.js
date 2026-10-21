// Ошибки, которые нужно показать клиенту с конкретным HTTP-статусом.
// Всё остальное считается непредвиденной ошибкой и превращается в 500.

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// details — список ошибок по конкретным полям: [{ path: 'fields[0].label', message: '...' }].
// По path интерфейс сможет подсветить нужное место.
export class ValidationError extends HttpError {
  constructor(details, message = 'Проверьте введённые данные') {
    super(400, message, details);
  }
}

export const notFound = (message = 'Не найдено') => new HttpError(404, message);
export const conflict = (message) => new HttpError(409, message);
