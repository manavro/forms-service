// API аналитики для админки.
//
//   GET    /api/forms/:id/analytics?days=7   воронка, статистика по вопросам и подсказки
//                                            days — 7 или 30; без него — за всё время
//   DELETE /api/forms/:id/analytics          сбросить аналитику формы (ответы не трогает)

import express from 'express';
import { ValidationError } from '../errors.js';

const ALLOWED_DAYS = new Set([7, 30]);

export function analyticsApiRouter(analytics) {
  const router = express.Router({ mergeParams: true });

  router.get('/', (req, res) => {
    let days = null;
    if (req.query.days !== undefined) {
      days = Number(req.query.days);
      if (!ALLOWED_DAYS.has(days)) {
        throw new ValidationError([{ path: 'days', message: 'Период может быть 7 или 30 дней' }]);
      }
    }
    const { form, ...report } = analytics.report(req.params.id, { days });
    res.json({
      form: { id: form.id, title: form.title, status: form.status, slug: form.slug },
      days,
      ...report,
    });
  });

  router.delete('/', async (req, res) => {
    await analytics.reset(req.params.id);
    res.status(204).end();
  });

  return router;
}
