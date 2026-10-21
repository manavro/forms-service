// Публичное API: то, чем пользуется страница формы у студента.
//
//   GET  /api/public/forms/:slug            форма для заполнения
//                                            404 — нет такой (или это черновик), 410 — приём закрыт
//   POST /api/public/forms/:slug/responses  отправить ответ
//                                            201 — принят, 400 — ошибки по полям, 410 — приём закрыт

import express from 'express';

export function publicApiRouter(responses) {
  const router = express.Router();

  router.get('/forms/:slug', (req, res) => {
    res.json({ form: responses.getPublicForm(req.params.slug) });
  });

  router.post('/forms/:slug/responses', async (req, res) => {
    await responses.submit(req.params.slug, req.body);
    res.status(201).json({ ok: true });
  });

  return router;
}
