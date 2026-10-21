// Точка входа: читаем настройки и запускаем HTTP-сервер.

import http from 'node:http';
import { createApp } from './src/app.js';
import { readPort } from './src/config.js';

let port;
try {
  port = readPort(process.env.PORT);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const server = http.createServer(createApp());

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Порт ${port} уже занят. Остановите другой процесс или укажите другой порт в переменной PORT.`);
    process.exit(1);
  }
  throw err;
});

server.listen(port, () => {
  console.log(`Сервис форм запущен: http://localhost:${port}`);
  console.log(`Админка:             http://localhost:${port}/admin`);
});

// Аккуратная остановка по Ctrl+C: перестаём принимать запросы и выходим.
function shutdown() {
  console.log('\nОстанавливаю сервер...');
  server.close(() => process.exit(0));
  // Если какие-то соединения висят, не ждём их вечно.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
