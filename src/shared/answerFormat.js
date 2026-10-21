// Превращение сохранённого ответа в текст для человека.
// Общий для сервера (выгрузка CSV) и браузера (таблица ответов), чтобы
// ответ выглядел одинаково и в админке, и в Excel.

// answer — элемент из response.answers: { fieldId, type, label, value }.
export function formatAnswer(answer) {
  if (!answer || answer.value === null || answer.value === undefined) return '';
  const { type, value } = answer;
  switch (type) {
    case 'single_choice':
    case 'dropdown':
      return value.label ?? '';
    case 'multiple_choice':
      return value.map((option) => option.label).join(', ');
    case 'checkbox':
      return value ? 'Да' : 'Нет';
    default:
      return String(value);
  }
}
