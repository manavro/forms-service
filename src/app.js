// Создание Express-приложения. Отделено от server.js, чтобы приложение
// можно было поднимать в тестах без реального порта.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const pagesDir = path.join(rootDir, 'pages');
const publicDir = path.join(rootDir, 'public');

export function createApp() {
  const app = express();

  // Не сообщаем наружу, на чём написан сервер.
  app.disable('x-powered-by');

  // Тело запросов — только JSON и не больше 100 КБ: форме отклика больше не нужно,
  // а огромные запросы не смогут забить память сервера.
  app.use(express.json({ limit: '100kb' }));

  // Статика (стили, скрипты страниц) — по префиксу /static.
  app.use('/static', express.static(publicDir));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  // Страницы.
  app.get('/', (req, res) => res.redirect('/admin'));
  app.get('/admin', (req, res) => res.sendFile(path.join(pagesDir, 'admin.html')));

  // Ничего не нашлось.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Не найдено' });
  });
  app.use((req, res) => {
    res.status(404).sendFile(path.join(pagesDir, 'not-found.html'));
  });

  // Непредвиденная ошибка: подробности — в лог сервера, пользователю — общее сообщение.
  // Express узнаёт обработчик ошибок по четырём аргументам, поэтому next обязателен.
  app.use((err, req, res, next) => {
    // Ошибки разбора тела запроса (битый JSON, слишком большой размер) — это ошибка клиента.
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Некорректный JSON в теле запроса' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Слишком большой запрос' });
    }

    console.error(err);
    if (req.path.startsWith('/api')) {
      return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
    res.status(500).send('Внутренняя ошибка сервера');
  });

  return app;
}
