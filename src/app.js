// Создание Express-приложения. Отделено от server.js, чтобы приложение
// можно было поднимать в тестах без реального порта и с временной папкой данных.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { HttpError } from './errors.js';
import { createFormService } from './forms/formService.js';
import { createResponseService } from './responses/responseService.js';
import { formsApiRouter } from './routes/formsApi.js';
import { publicApiRouter } from './routes/publicApi.js';
import { securityHeaders } from './securityHeaders.js';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const pagesDir = path.join(rootDir, 'pages');
const publicDir = path.join(rootDir, 'public');
const sharedDir = path.join(rootDir, 'src', 'shared');

// db — открытое хранилище (см. storage/database.js).
export function createApp({ db }) {
  const app = express();
  const forms = createFormService(db);
  const responses = createResponseService(db);

  // Не сообщаем наружу, на чём написан сервер.
  app.disable('x-powered-by');
  app.use(securityHeaders);

  // Тело запросов — только JSON и не больше 100 КБ: форме отклика больше не нужно,
  // а огромные запросы не смогут забить память сервера.
  app.use(express.json({ limit: '100kb' }));

  // Статика (стили, скрипты страниц) — по префиксу /static.
  app.use('/static', express.static(publicDir));
  // Общий с сервером код (типы полей, лимиты) — по префиксу /shared.
  app.use('/shared', express.static(sharedDir));

  // Ответы API всегда актуальны: браузер не должен их кешировать. Иначе, например,
  // после повторного открытия приёма студент мог бы увидеть сохранённое «приём закрыт».
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/forms', formsApiRouter(forms));
  app.use('/api/public', publicApiRouter(responses));

  // Страницы.
  app.get('/', (req, res) => res.redirect('/admin'));
  app.get('/admin', (req, res) => res.sendFile(path.join(pagesDir, 'admin.html')));
  app.get('/admin/forms/:id', (req, res) => res.sendFile(path.join(pagesDir, 'admin-form.html')));
  // Страница формы для студента. Саму форму она загружает через /api/public.
  app.get('/f/:slug', (req, res) => res.sendFile(path.join(pagesDir, 'form.html')));

  // Ничего не нашлось.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Не найдено' });
  });
  app.use((req, res) => {
    res.status(404).sendFile(path.join(pagesDir, 'not-found.html'));
  });

  // Обработчик ошибок. Express узнаёт его по четырём аргументам, поэтому next обязателен.
  app.use((err, req, res, next) => {
    // Ожидаемые ошибки (не найдено, неверные данные, конфликт версий) — отдаём как есть.
    if (err instanceof HttpError) {
      return res.status(err.status).json({ ...err.extra, error: err.message, details: err.details });
    }
    // Ошибки разбора тела запроса (битый JSON, слишком большой размер) — это ошибка клиента.
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Некорректный JSON в теле запроса' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Слишком большой запрос' });
    }

    // Непредвиденная ошибка: подробности — в лог сервера, пользователю — общее сообщение.
    console.error(err);
    if (res.headersSent) return next(err);
    if (req.path.startsWith('/api')) {
      return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
    res.status(500).send('Внутренняя ошибка сервера');
  });

  return app;
}
