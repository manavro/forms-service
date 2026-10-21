// Ответы на форму в виде таблицы: колонки — вопросы, строки — ответы.
// Используется и для страницы ответов в админке, и для выгрузки в CSV.
//
// Колонки:
// - сначала текущие вопросы формы в их текущем порядке и с текущими названиями;
// - затем вопросы, которые из формы уже удалили, но ответы на них остались.
//   Их название берём из самого свежего ответа и помечаем deleted: true.

export function buildResponseTable(form, responses) {
  const columns = form.fields.map((field) => ({
    fieldId: field.id,
    label: field.label,
    type: field.type,
    deleted: false,
  }));

  const deletedColumns = new Map();
  const currentIds = new Set(columns.map((c) => c.fieldId));
  // responses идут в порядке отправки, поэтому последняя запись оставит самое свежее название.
  for (const response of responses) {
    for (const answer of response.answers) {
      if (currentIds.has(answer.fieldId)) continue;
      deletedColumns.set(answer.fieldId, {
        fieldId: answer.fieldId,
        label: answer.label,
        type: answer.type,
        deleted: true,
      });
    }
  }

  // Номер ответа — порядковый по времени отправки среди сохранённых ответов (№ 1 — самый первый).
  // Те же номера стоят в CSV, поэтому ответ из таблицы легко найти в выгрузке.
  const rows = responses.map((response, index) => ({
    id: response.id,
    number: index + 1,
    submittedAt: response.submittedAt,
    answers: Object.fromEntries(response.answers.map((a) => [a.fieldId, a])),
  }));

  return {
    columns: [...columns, ...deletedColumns.values()],
    // Свежие ответы — сверху.
    rows: rows.reverse(),
  };
}
