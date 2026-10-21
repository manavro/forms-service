import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { FIELD_TYPES } from '../src/shared/fieldTypes.js';
import { createDemoForm } from '../src/forms/demoForm.js';
import { openDatabase } from '../src/storage/database.js';
import { makeTempDir } from './helpers.js';

describe('Демо-форма', () => {
  let temp;
  beforeEach(async () => {
    temp = await makeTempDir();
  });
  afterEach(() => temp.cleanup());

  test('создаётся опубликованной и показывает все типы полей', async () => {
    const db = await openDatabase(temp.dir);
    const form = await createDemoForm(db);
    await db.flush();

    assert.equal(form.status, 'published');
    assert.deepEqual(new Set(form.fields.map((f) => f.type)), new Set(Object.keys(FIELD_TYPES)));
    assert.equal(db.state.forms.length, 1);
  });
});
