// API админки для просмотра ответов на форму.
//
//   GET    /api/forms/:id/responses               таблица ответов: колонки (вопросы) и строки (ответы)
//   GET    /api/forms/:id/responses/export        то же самое файлом CSV для Excel
//   DELETE /api/forms/:id/responses/:responseId   удалить один ответ

import express from 'express';
import { csvFileName, responsesToCsv } from '../responses/csv.js';

export function responsesApiRouter(responses) {
  // mergeParams — чтобы видеть :id из адреса, к которому подключён этот роутер.
  const router = express.Router({ mergeParams: true });

  router.get('/', (req, res) => {
    const { form, table } = responses.table(req.params.id);
    res.json({
      form: { id: form.id, title: form.title, status: form.status, slug: form.slug },
      columns: table.columns,
      rows: table.rows,
    });
  });

  router.get('/export', (req, res) => {
    const { form, table } = responses.table(req.params.id);
    const fileName = csvFileName(form.title);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // Имя файла на кириллице передаём в виде filename* (RFC 5987), а для старых
    // программ оставляем запасное латинское имя.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="responses.csv"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.send(responsesToCsv(table));
  });

  router.delete('/:responseId', async (req, res) => {
    await responses.remove(req.params.id, req.params.responseId);
    res.status(204).end();
  });

  return router;
}
