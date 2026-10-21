// Склонение слова после числа (общее для сервера и браузера).
// plural(5, ['раз', 'раза', 'раз']) → 'раз'; countLabel(3, ['ответ', 'ответа', 'ответов']) → '3 ответа'

export function plural(n, [one, few, many]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function countLabel(n, forms) {
  return `${n} ${plural(n, forms)}`;
}
