// Атомарная запись файла: пишем во временный файл, сбрасываем его на диск,
// затем переименовываем поверх основного. Переименование в пределах одной
// папки выполняется операционной системой целиком, поэтому основной файл
// всегда либо старый, либо новый — но не обрезанный посередине.

import fs from 'node:fs/promises';

export async function writeFileAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  const handle = await fs.open(tmpPath, 'w');
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await renameWithRetry(tmpPath, filePath);
}

// На Windows антивирус или индексатор могут на мгновение занять файл,
// и переименование падает с EPERM/EBUSY. В этом случае пробуем ещё несколько раз.
async function renameWithRetry(from, to) {
  const attempts = 10;
  for (let i = 1; ; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const retriable = ['EPERM', 'EACCES', 'EBUSY'].includes(err.code);
      if (!retriable || i === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 20 * i));
    }
  }
}
