// Обёртка над fetch для запросов к нашему API.
// Ответы с ошибкой превращаются в ApiError с текстом от сервера
// и списком ошибок по полям (details).

export class ApiError extends Error {
  constructor(status, message, details = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Проверьте, что он запущен, и попробуйте ещё раз.');
  }

  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Ответ не JSON — ниже это обработается как ошибка.
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Ошибка сервера (${res.status})`, data?.details ?? []);
  }
  return data;
}
