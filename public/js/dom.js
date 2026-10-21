// Маленький помощник для создания DOM-элементов.
//
//   h('button', { class: 'btn', onclick: save }, 'Сохранить')
//
// Строки всегда превращаются в текстовые узлы, а не в HTML. Поэтому текст,
// который ввёл менеджер или студент, не может стать разметкой или скриптом (защита от XSS).
// В проекте нигде не используется innerHTML с пользовательскими данными.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  append(el, children);

  // Свойства выставляем после детей: например, value у <select> можно задать
  // только когда варианты уже добавлены.
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') {
      el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in el && !key.includes('-')) {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

// Заменяет содержимое элемента.
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
}
