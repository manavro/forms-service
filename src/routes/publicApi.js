// Публичное API: то, чем пользуется страница формы у студента.
//
//   GET  /api/public/forms/:slug            форма для заполнения
//                                            404 — нет такой (или это черновик), 410 — приём закрыт
//   POST /api/public/forms/:slug/responses  отправить ответ
//                                            201 — принят, 400 — ошибки по полям, 410 — приём закрыт
//   POST /api/public/forms/:slug/events     события заполнения для аналитики (204)

import express from 'express';

export function publicApiRouter(responses, analytics) {
  const router = express.Router();

  router.get('/forms/:slug', (req, res) => {
    res.json({ form: responses.getPublicForm(req.params.slug) });
  });

  router.post('/forms/:slug/responses', async (req, res) => {
    const result = await responses.submit(req.params.slug, req.body);
    if (result.saved) {
      // Ответ уже сохранён: если запись события не удастся, студенту об этом знать не нужно.
      try {
        await analytics.recordSubmit(result.formId, result.sessionId, req.body?.elapsed);
      } catch (err) {
        console.error('Не удалось записать событие отправки:', err);
      }
    }
    res.status(201).json({ ok: true });
  });

  // События шлются маленькими пачками (до 50 штук), а при уходе со страницы — через navigator.sendBeacon.
  router.post('/forms/:slug/events', async (req, res) => {
    await analytics.record(req.params.slug, req.body);
    res.status(204).end();
  });

  return router;
}
