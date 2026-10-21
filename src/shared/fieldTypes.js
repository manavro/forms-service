// Типы полей и ограничения формы.
//
// Этот файл общий для сервера и браузера: сервер импортирует его напрямую,
// а браузер получает по адресу /shared/fieldTypes.js. Так список типов
// и лимиты описаны в одном месте и не могут разойтись.
// Поэтому здесь нельзя использовать ничего специфичного для Node.js.

export const FIELD_TYPES = {
  short_text: { title: 'Короткий текст', hasOptions: false, hasPlaceholder: true },
  long_text: { title: 'Длинный текст', hasOptions: false, hasPlaceholder: true },
  email: { title: 'Email', hasOptions: false, hasPlaceholder: true },
  phone: { title: 'Телефон', hasOptions: false, hasPlaceholder: true },
  single_choice: { title: 'Один вариант', hasOptions: true, hasPlaceholder: false },
  multiple_choice: { title: 'Несколько вариантов', hasOptions: true, hasPlaceholder: false },
  dropdown: { title: 'Выпадающий список', hasOptions: true, hasPlaceholder: false },
  checkbox: { title: 'Галочка (например, согласие)', hasOptions: false, hasPlaceholder: false },
};

export const FORM_LIMITS = {
  titleMax: 200,
  descriptionMax: 2000,
  fieldsMax: 50,
  labelMax: 300,
  helpMax: 500,
  placeholderMax: 150,
  optionsMin: 2,
  optionsMax: 50,
  optionLabelMax: 200,
};

export const FORM_STATUSES = {
  draft: 'Черновик',
  published: 'Опубликована',
  closed: 'Приём закрыт',
};
