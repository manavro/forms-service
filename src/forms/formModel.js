// Проверка и нормализация содержимого формы, присланного из админки.
//
// Принцип: берём из запроса только известные свойства (название, описание, поля)
// и строим объект заново. Всё лишнее отбрасывается — например, клиент не сможет
// подменить статус или ссылку формы, просто дописав их в запрос.
//
// Ошибки собираются все сразу, а не по одной: менеджер увидит весь список
// проблем за одно сохранение.

import { FIELD_TYPES, FORM_LIMITS } from '../shared/fieldTypes.js';
import { ValidationError } from '../errors.js';
import { ID_PATTERN, randomId } from '../ids.js';

// Возвращает { title, description, fields } или бросает ValidationError.
export function parseFormContent(input) {
  const errors = [];

  if (!isPlainObject(input)) {
    throw new ValidationError([{ path: '', message: 'Ожидался JSON-объект с данными формы' }]);
  }

  const title = readText(input.title, 'title', errors, {
    max: FORM_LIMITS.titleMax,
    requiredMessage: 'Введите название формы',
  });
  const description = readText(input.description, 'description', errors, {
    max: FORM_LIMITS.descriptionMax,
  });
  const fields = readFields(input.fields, errors);

  if (errors.length > 0) throw new ValidationError(errors);
  return { title, description, fields };
}

function readFields(value, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push({ path: 'fields', message: 'Список полей должен быть массивом' });
    return [];
  }
  if (value.length > FORM_LIMITS.fieldsMax) {
    errors.push({ path: 'fields', message: `В форме может быть не больше ${FORM_LIMITS.fieldsMax} полей` });
    return [];
  }

  const usedIds = new Set();
  return value.map((raw, index) => readField(raw, `fields[${index}]`, usedIds, errors)).filter(Boolean);
}

function readField(raw, path, usedIds, errors) {
  if (!isPlainObject(raw)) {
    errors.push({ path, message: 'Поле описано некорректно' });
    return null;
  }

  const typeInfo = Object.hasOwn(FIELD_TYPES, raw.type) ? FIELD_TYPES[raw.type] : null;
  if (!typeInfo) {
    errors.push({ path: `${path}.type`, message: 'Неизвестный тип поля' });
    return null;
  }

  const field = {
    id: readId(raw.id, `${path}.id`, usedIds, errors),
    type: raw.type,
    label: readText(raw.label, `${path}.label`, errors, {
      max: FORM_LIMITS.labelMax,
      requiredMessage: 'Введите текст вопроса',
    }),
    help: readText(raw.help, `${path}.help`, errors, { max: FORM_LIMITS.helpMax }),
    required: readBoolean(raw.required, `${path}.required`, errors),
  };

  if (typeInfo.hasPlaceholder) {
    field.placeholder = readText(raw.placeholder, `${path}.placeholder`, errors, {
      max: FORM_LIMITS.placeholderMax,
    });
  }
  if (typeInfo.hasOptions) {
    field.options = readOptions(raw.options, `${path}.options`, errors);
  }
  return field;
}

function readOptions(value, path, errors) {
  const tooFewMessage = `Добавьте хотя бы ${FORM_LIMITS.optionsMin} варианта ответа`;
  if (!Array.isArray(value)) {
    errors.push({ path, message: tooFewMessage });
    return [];
  }
  if (value.length > FORM_LIMITS.optionsMax) {
    errors.push({ path, message: `Вариантов может быть не больше ${FORM_LIMITS.optionsMax}` });
    return [];
  }
  if (value.length < FORM_LIMITS.optionsMin) errors.push({ path, message: tooFewMessage });

  const usedIds = new Set();
  const usedLabels = new Set();
  return value.map((raw, index) => {
    const optionPath = `${path}[${index}]`;
    const option = isPlainObject(raw) ? raw : {};
    if (!isPlainObject(raw)) errors.push({ path: optionPath, message: 'Вариант ответа описан некорректно' });

    const label = readText(option.label, `${optionPath}.label`, errors, {
      max: FORM_LIMITS.optionLabelMax,
      requiredMessage: 'Введите текст варианта',
    });
    // Одинаковые варианты путают и студента, и менеджера при разборе ответов.
    const key = label.toLocaleLowerCase('ru');
    if (label && usedLabels.has(key)) {
      errors.push({ path: `${optionPath}.label`, message: 'Такой вариант уже есть' });
    }
    usedLabels.add(key);

    return { id: readId(option.id, `${optionPath}.id`, usedIds, errors), label };
  });
}

// Id поля или варианта. Клиент присылает id уже существующих элементов, чтобы они
// не менялись при редактировании (к ним привязаны ответы). Новым элементам id выдаёт сервер.
function readId(value, path, usedIds, errors) {
  let id = value;
  if (id === undefined || id === null || id === '') {
    do {
      id = randomId(6);
    } while (usedIds.has(id));
  } else if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    errors.push({ path, message: 'Некорректный идентификатор' });
    return randomId(6);
  } else if (usedIds.has(id)) {
    errors.push({ path, message: 'Идентификатор повторяется' });
  }
  usedIds.add(id);
  return id;
}

function readText(value, path, errors, { max, requiredMessage }) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') {
    errors.push({ path, message: 'Ожидалась строка' });
    return '';
  }
  const text = value.trim();
  if (requiredMessage && text === '') errors.push({ path, message: requiredMessage });
  if (text.length > max) errors.push({ path, message: `Не длиннее ${max} символов` });
  return text;
}

function readBoolean(value, path, errors) {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') {
    errors.push({ path, message: 'Ожидалось true или false' });
    return false;
  }
  return value;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
