import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ValidationError } from '../src/errors.js';
import { parseFormContent } from '../src/forms/formModel.js';

// Возвращает список путей с ошибками, чтобы было удобно сравнивать.
function errorPaths(input) {
  try {
    parseFormContent(input);
  } catch (err) {
    assert.ok(err instanceof ValidationError);
    return err.details.map((d) => d.path);
  }
  assert.fail('ожидалась ошибка проверки');
}

describe('parseFormContent', () => {
  test('нормализует корректную форму: обрезает пробелы, выдаёт id, ставит значения по умолчанию', () => {
    const result = parseFormContent({
      title: '  Летняя стажировка  ',
      fields: [
        { type: 'short_text', label: ' ФИО ', required: true },
        { type: 'dropdown', label: 'Курс', options: [{ label: '1' }, { label: '2' }] },
        { type: 'checkbox', label: 'Согласен на обработку данных', required: true },
      ],
    });

    assert.equal(result.title, 'Летняя стажировка');
    assert.equal(result.description, '');
    assert.equal(result.fields.length, 3);

    const [name, course, consent] = result.fields;
    assert.match(name.id, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(
      { ...name, id: undefined },
      { id: undefined, type: 'short_text', label: 'ФИО', help: '', required: true, placeholder: '' },
    );
    assert.equal(course.required, false);
    assert.deepEqual(
      course.options.map((o) => o.label),
      ['1', '2'],
    );
    assert.ok(course.options.every((o) => o.id));
    assert.equal('options' in consent, false);
    assert.equal('placeholder' in consent, false);
  });

  test('сохраняет присланные id полей и вариантов', () => {
    const result = parseFormContent({
      title: 'Форма',
      fields: [{ id: 'abc', type: 'single_choice', label: 'Да?', options: [{ id: 'o1', label: 'Да' }, { id: 'o2', label: 'Нет' }] }],
    });
    assert.equal(result.fields[0].id, 'abc');
    assert.deepEqual(
      result.fields[0].options.map((o) => o.id),
      ['o1', 'o2'],
    );
  });

  test('отбрасывает лишние свойства', () => {
    const result = parseFormContent({
      title: 'Форма',
      status: 'published',
      slug: 'hack',
      fields: [{ type: 'email', label: 'Почта', onclick: 'alert(1)' }],
    });
    assert.deepEqual(Object.keys(result), ['title', 'description', 'fields']);
    assert.equal('onclick' in result.fields[0], false);
  });

  test('требует название формы', () => {
    assert.deepEqual(errorPaths({ title: '   ' }), ['title']);
    assert.deepEqual(errorPaths({}), ['title']);
  });

  test('не принимает не-объект', () => {
    assert.deepEqual(errorPaths(null), ['']);
    assert.deepEqual(errorPaths([1, 2]), ['']);
  });

  test('проверяет поля и собирает все ошибки сразу', () => {
    const paths = errorPaths({
      title: 'Форма',
      fields: [
        { type: 'unknown', label: 'x' },
        { type: 'short_text', label: '' },
        { type: 'short_text', label: 'Ок', required: 'yes' },
        { type: 'dropdown', label: 'Выбор', options: [{ label: 'Один' }] },
        { type: 'single_choice', label: 'Выбор', options: [{ label: 'Да' }, { label: ' да ' }] },
        { type: 'multiple_choice', label: 'Выбор' },
      ],
    });
    assert.deepEqual(paths, [
      'fields[0].type',
      'fields[1].label',
      'fields[2].required',
      'fields[3].options',
      'fields[4].options[1].label',
      'fields[5].options',
    ]);
  });

  test('не принимает повторяющиеся и некорректные id', () => {
    const paths = errorPaths({
      title: 'Форма',
      fields: [
        { id: 'same', type: 'email', label: 'A' },
        { id: 'same', type: 'email', label: 'B' },
        { id: 'с пробелом', type: 'email', label: 'C' },
      ],
    });
    assert.deepEqual(paths, ['fields[1].id', 'fields[2].id']);
  });

  test('проверяет ограничения длины и количества', () => {
    assert.deepEqual(errorPaths({ title: 'а'.repeat(201) }), ['title']);
    assert.deepEqual(
      errorPaths({ title: 'Форма', fields: Array.from({ length: 51 }, () => ({ type: 'email', label: 'x' })) }),
      ['fields'],
    );
  });

  test('сообщения об ошибках — на русском', () => {
    assert.throws(
      () => parseFormContent({ title: '' }),
      (err) => err.details[0].message === 'Введите название формы',
    );
  });
});
