// Точка входа: читаем настройки, открываем данные и запускаем HTTP-сервер.

import http from 'node:http';
import { createApp } from './src/app.js';
import { readDataDir, readPort } from './src/config.js';
import { openDatabase } from './src/storage/database.js';

let port;
let db;
try {
  port = readPort(process.env.PORT);
  db = await openDatabase(readDataDir(process.env.DATA_DIR));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const server = http.createServer(createApp({ db }));

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

// Аккуратная остановка по Ctrl+C: перестаём принимать запросы,
// дожидаемся записи данных на диск и выходим.
function shutdown() {
  console.log('\nОстанавливаю сервер...');
  server.close();
  db.flush().finally(() => process.exit(0));
  // Если что-то зависло, не ждём вечно.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
