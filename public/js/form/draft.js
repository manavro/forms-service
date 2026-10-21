// Черновик ответов в браузере студента (localStorage).
//
// Зачем: студент закрыл вкладку, его отвлекли, села батарейка — при возврате
// по той же ссылке ответы на месте. Это прямо снижает число брошенных форм.
//
// Черновик хранится только в этом браузере и никуда не отправляется.
// Он удаляется после отправки ответа, по кнопке «Начать заново» и сам — через неделю.
// localStorage может быть недоступен (приватный режим, запрет сайту хранить данные),
// поэтому все обращения к нему обёрнуты в try/catch: без черновика форма всё равно работает.

const PREFIX = 'forms-service:draft:';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function loadDraft(slug) {
  try {
    const raw = localStorage.getItem(PREFIX + slug);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    const valid = draft && typeof draft.savedAt === 'number' && draft.answers && typeof draft.answers === 'object';
    if (!valid || Date.now() - draft.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(PREFIX + slug);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function saveDraft(slug, answers) {
  try {
    const hasSomething = Object.values(answers).some(
      (v) => v !== null && v !== undefined && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0),
    );
    if (hasSomething) localStorage.setItem(PREFIX + slug, JSON.stringify({ savedAt: Date.now(), answers }));
    else localStorage.removeItem(PREFIX + slug);
  } catch {
    // Не получилось сохранить — не страшно, просто не будет черновика.
  }
}

export function clearDraft(slug) {
  try {
    localStorage.removeItem(PREFIX + slug);
  } catch {
    // Нечего очищать.
  }
}
