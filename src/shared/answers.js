// Проверка ответов студента.
//
// Файл общий для сервера и браузера (как и fieldTypes.js):
// - браузер проверяет ответы сразу, чтобы студент увидел ошибку до отправки;
// - сервер проверяет те же ответы ещё раз, потому что браузерную проверку
//   легко обойти, отправив запрос напрямую.
// Правила записаны один раз, поэтому браузер и сервер не могут разойтись.

export const ANSWER_LIMITS = {
  shortTextMax: 500,
  longTextMax: 5000,
  emailMax: 254,
  phoneMax: 30,
};

const TEXT_MAX = {
  short_text: ANSWER_LIMITS.shortTextMax,
  long_text: ANSWER_LIMITS.longTextMax,
  email: ANSWER_LIMITS.emailMax,
  phone: ANSWER_LIMITS.phoneMax,
};

// Простая проверка: что-то@что-то.домен без пробелов. Полную проверку адреса
// делает только письмо, а слишком строгое правило отсекло бы реальные адреса.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS = /^[+\d\s().-]+$/;

// Проверяет ответ на одно поле.
// Возвращает { value } — очищенное значение, или { value, error } — текст ошибки.
// Пустое необязательное поле — не ошибка: value будет null, [] или false.
export function validateAnswer(field, raw) {
  switch (field.type) {
    case 'short_text':
    case 'long_text':
    case 'email':
    case 'phone':
      return validateText(field, raw);
    case 'single_choice':
    case 'dropdown':
      return validateSingleChoice(field, raw);
    case 'multiple_choice':
      return validateMultipleChoice(field, raw);
    case 'checkbox':
      return validateCheckbox(field, raw);
    default:
      return { value: null, error: 'Неизвестный тип поля' };
  }
}

// Проверяет ответы на все поля формы.
// raw — объект { [id поля]: значение }. Ответы на поля, которых нет в форме, игнорируются.
// Возвращает { values, errors }: values — очищенные ответы по id поля,
// errors — тексты ошибок по id поля (пустой объект, если ошибок нет).
export function validateAnswers(fields, raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const values = {};
  const errors = {};
  for (const field of fields) {
    // Object.hasOwn — чтобы не прочитать что-то из прототипа объекта (например, по ключу "constructor").
    const { value, error } = validateAnswer(field, Object.hasOwn(source, field.id) ? source[field.id] : undefined);
    values[field.id] = value;
    if (error) errors[field.id] = error;
  }
  return { values, errors };
}

function validateText(field, raw) {
  if (raw === undefined || raw === null) raw = '';
  if (typeof raw !== 'string') return { value: null, error: 'Некорректный ответ' };

  const text = raw.trim();
  if (text === '') return field.required ? { value: null, error: 'Заполните это поле' } : { value: null };

  const max = TEXT_MAX[field.type];
  if (text.length > max) return { value: text, error: `Слишком длинный ответ: не больше ${max} символов` };

  if (field.type === 'email' && !EMAIL_PATTERN.test(text)) {
    return { value: text, error: 'Проверьте адрес почты. Пример: ivan@example.com' };
  }
  if (field.type === 'phone') {
    const digits = text.replace(/\D/g, '').length;
    if (!PHONE_CHARS.test(text) || digits < 10 || digits > 15) {
      return { value: text, error: 'Проверьте номер телефона. Пример: +7 999 123-45-67' };
    }
  }
  return { value: text };
}

function validateSingleChoice(field, raw) {
  if (raw === undefined || raw === null || raw === '') {
    return field.required ? { value: null, error: 'Выберите вариант' } : { value: null };
  }
  if (typeof raw !== 'string' || !field.options.some((o) => o.id === raw)) {
    return { value: null, error: 'Выберите один из предложенных вариантов' };
  }
  return { value: raw };
}

function validateMultipleChoice(field, raw) {
  if (raw === undefined || raw === null) raw = [];
  if (!Array.isArray(raw) || raw.some((id) => !field.options.some((o) => o.id === id))) {
    return { value: [], error: 'Выберите варианты из предложенных' };
  }
  // Порядок — как в форме, повторы убираются.
  const value = field.options.filter((o) => raw.includes(o.id)).map((o) => o.id);
  if (field.required && value.length === 0) return { value, error: 'Выберите хотя бы один вариант' };
  return { value };
}

function validateCheckbox(field, raw) {
  if (raw === undefined || raw === null) raw = false;
  if (typeof raw !== 'boolean') return { value: false, error: 'Некорректный ответ' };
  if (field.required && !raw) return { value: false, error: 'Поставьте отметку, чтобы отправить форму' };
  return { value: raw };
}
