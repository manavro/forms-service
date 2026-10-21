// HTTP API админки для работы с формами.
//
//   GET    /api/forms                 список форм
//   POST   /api/forms                 создать форму (черновик)
//   GET    /api/forms/:id             одна форма целиком
//   PUT    /api/forms/:id             сохранить название, описание и поля (нужна version)
//   DELETE /api/forms/:id             удалить форму вместе с ответами
//   POST   /api/forms/:id/publish     опубликовать / снова открыть приём
//   POST   /api/forms/:id/close       закрыть приём ответов
//   POST   /api/forms/:id/duplicate   создать копию формы
//
// Маршруты только переводят HTTP в вызовы formService и обратно —
// вся логика и проверки находятся в сервисе.

import express from 'express';

export function formsApiRouter(forms) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ forms: forms.list() });
  });

  router.post('/', async (req, res) => {
    res.status(201).json({ form: await forms.create(req.body) });
  });

  router.get('/:id', (req, res) => {
    res.json({ form: forms.get(req.params.id) });
  });

  router.put('/:id', async (req, res) => {
    res.json({ form: await forms.update(req.params.id, req.body) });
  });

  router.delete('/:id', async (req, res) => {
    await forms.remove(req.params.id);
    res.status(204).end();
  });

  router.post('/:id/publish', async (req, res) => {
    res.json({ form: await forms.publish(req.params.id) });
  });

  router.post('/:id/close', async (req, res) => {
    res.json({ form: await forms.close(req.params.id) });
  });

  router.post('/:id/duplicate', async (req, res) => {
    res.status(201).json({ form: await forms.duplicate(req.params.id) });
  });

  return router;
}
