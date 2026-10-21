// Демо-форма, которая создаётся при самом первом запуске (когда данных ещё нет).
// Так после `npm start` в админке сразу есть пример со всеми типами полей,
// а не пустой экран. Её можно отредактировать или удалить как любую другую форму.

import { createFormService } from './formService.js';

const DEMO_FORM = {
  title: 'Пример: летняя стажировка в веб-разработке',
  description:
    'Это демонстрационная форма — её создал сервис при первом запуске. Её можно отредактировать или удалить.\n' +
    'Заполнение займёт около 3 минут. Мы отвечаем на отклики в течение недели.',
  fields: [
    { type: 'short_text', label: 'Фамилия и имя', required: true, placeholder: 'Иванова Анна' },
    { type: 'email', label: 'Почта', required: true, placeholder: 'anna@example.com' },
    {
      type: 'phone',
      label: 'Телефон',
      help: 'Позвоним, чтобы договориться о собеседовании',
      placeholder: '+7 999 123-45-67',
    },
    {
      type: 'dropdown',
      label: 'Курс',
      required: true,
      options: [{ label: '1 курс' }, { label: '2 курс' }, { label: '3 курс' }, { label: '4 курс' }, { label: 'Магистратура' }],
    },
    {
      type: 'single_choice',
      label: 'Удобный формат работы',
      options: [{ label: 'В офисе' }, { label: 'Удалённо' }, { label: 'Гибрид' }],
    },
    {
      type: 'multiple_choice',
      label: 'С чем уже работали',
      required: true,
      options: [{ label: 'HTML и CSS' }, { label: 'JavaScript' }, { label: 'Node.js' }, { label: 'Git' }],
    },
    {
      type: 'long_text',
      label: 'Почему хотите к нам на стажировку',
      help: 'Пары предложений достаточно',
    },
    { type: 'checkbox', label: 'Согласен на обработку персональных данных', required: true },
  ],
};

// Создаёт и публикует демо-форму. Возвращает её (нужна ссылка для сообщения в консоли).
export async function createDemoForm(db) {
  const forms = createFormService(db);
  const form = await forms.create(DEMO_FORM);
  return forms.publish(form.id);
}
