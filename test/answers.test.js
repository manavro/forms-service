import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validateAnswer, validateAnswers } from '../src/shared/answers.js';

const options = [
  { id: 'o1', label: 'Первый' },
  { id: 'o2', label: 'Второй' },
  { id: 'o3', label: 'Третий' },
];
const field = (type, extra = {}) => ({ id: 'f', type, label: 'Вопрос', required: false, ...extra });

describe('validateAnswer', () => {
  test('текст: обрезает пробелы, пустое необязательное поле — не ошибка', () => {
    assert.deepEqual(validateAnswer(field('short_text'), '  Иван  '), { value: 'Иван' });
    assert.deepEqual(validateAnswer(field('short_text'), '   '), { value: null });
    assert.deepEqual(validateAnswer(field('short_text'), undefined), { value: null });
  });

  test('текст: обязательное поле и ограничение длины', () => {
    assert.equal(validateAnswer(field('short_text', { required: true }), '').error, 'Заполните это поле');
    assert.match(validateAnswer(field('short_text'), 'а'.repeat(501)).error, /не больше 500/);
    assert.equal(validateAnswer(field('long_text'), 'а'.repeat(5000)).error, undefined);
    assert.equal(validateAnswer(field('short_text'), 42).error, 'Некорректный ответ');
  });

  test('email', () => {
    assert.equal(validateAnswer(field('email'), 'ivan@example.com').error, undefined);
    assert.equal(validateAnswer(field('email'), 'ivan.petrov+hr@mail.co.uk').error, undefined);
    for (const bad of ['ivan', 'ivan@', 'ivan@mail', 'iv an@mail.ru', '@mail.ru']) {
      assert.match(validateAnswer(field('email'), bad).error, /почты/, bad);
    }
  });

  test('телефон: от 10 до 15 цифр, допустимы пробелы, скобки, дефисы и +', () => {
    for (const ok of ['+7 999 123-45-67', '8 (999) 123-45-67', '89991234567', '+44 20 7946 0958']) {
      assert.equal(validateAnswer(field('phone'), ok).error, undefined, ok);
    }
    for (const bad of ['12345', '+7 999 abc-45-67', '1234567890123456']) {
      assert.match(validateAnswer(field('phone'), bad).error, /телефона/, bad);
    }
  });

  test('один вариант / выпадающий список: только существующие варианты', () => {
    for (const type of ['single_choice', 'dropdown']) {
      assert.deepEqual(validateAnswer(field(type, { options }), 'o2'), { value: 'o2' });
      assert.deepEqual(validateAnswer(field(type, { options }), ''), { value: null });
      assert.equal(validateAnswer(field(type, { options, required: true }), null).error, 'Выберите вариант');
      assert.ok(validateAnswer(field(type, { options }), 'чужой').error);
      assert.ok(validateAnswer(field(type, { options }), ['o1']).error);
    }
  });

  test('несколько вариантов: порядок как в форме, без повторов', () => {
    assert.deepEqual(validateAnswer(field('multiple_choice', { options }), ['o3', 'o1', 'o3']), { value: ['o1', 'o3'] });
    assert.deepEqual(validateAnswer(field('multiple_choice', { options }), undefined), { value: [] });
    assert.equal(
      validateAnswer(field('multiple_choice', { options, required: true }), []).error,
      'Выберите хотя бы один вариант',
    );
    assert.ok(validateAnswer(field('multiple_choice', { options }), ['o1', 'x']).error);
    assert.ok(validateAnswer(field('multiple_choice', { options }), 'o1').error);
  });

  test('галочка: обязательная должна быть отмечена', () => {
    assert.deepEqual(validateAnswer(field('checkbox'), true), { value: true });
    assert.deepEqual(validateAnswer(field('checkbox'), undefined), { value: false });
    assert.ok(validateAnswer(field('checkbox', { required: true }), false).error);
    assert.ok(validateAnswer(field('checkbox'), 'yes').error);
  });
});

describe('validateAnswers', () => {
  const fields = [
    { id: 'name', type: 'short_text', label: 'ФИО', required: true },
    { id: 'mail', type: 'email', label: 'Почта', required: true },
    { id: 'about', type: 'long_text', label: 'О себе', required: false },
  ];

  test('собирает значения и ошибки по id полей, лишние ответы игнорирует', () => {
    const { values, errors } = validateAnswers(fields, { name: ' Иван ', mail: 'плохая', extra: 'x' });
    assert.deepEqual(values, { name: 'Иван', mail: 'плохая', about: null });
    assert.deepEqual(Object.keys(errors), ['mail']);
  });

  test('не читает значения из прототипа объекта', () => {
    const { values } = validateAnswers([{ id: 'constructor', type: 'short_text', label: 'x' }], {});
    assert.equal(values.constructor, null);
  });

  test('не объект вместо ответов — все поля считаются пустыми', () => {
    const { errors } = validateAnswers(fields, 'строка');
    assert.deepEqual(Object.keys(errors), ['name', 'mail']);
  });
});
