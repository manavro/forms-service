// Точка входа: читаем настройки, открываем данные и запускаем HTTP-сервер.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createApp } from './src/app.js';
import { readDataDir, readPort } from './src/config.js';
import { createDemoForm } from './src/forms/demoForm.js';
import { openDatabase, openEventLog } from './src/storage/database.js';

let port;
let db;
let eventLog;
let demoForm = null;
try {
  port = readPort(process.env.PORT);
  const dataDir = readDataDir(process.env.DATA_DIR);
  // Самый первый запуск — файла данных ещё нет. Тогда создадим демо-форму, чтобы админка не была пустой.
  const firstRun = !fs.existsSync(path.join(dataDir, 'db.json'));
  db = await openDatabase(dataDir);
  eventLog = await openEventLog(dataDir);
  if (firstRun) demoForm = await createDemoForm(db);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const server = http.createServer(createApp({ db, eventLog }));

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
  if (demoForm) console.log(`Создана демо-форма:  http://localhost:${port}/f/${demoForm.slug}`);
});

// Аккуратная остановка по Ctrl+C: перестаём принимать запросы,
// дожидаемся записи данных на диск и выходим.
function shutdown() {
  console.log('\nОстанавливаю сервер...');
  server.close();
  Promise.all([db.flush(), eventLog.flush()]).finally(() => process.exit(0));
  // Если что-то зависло, не ждём вечно.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
