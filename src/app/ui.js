// Small DOM toolkit: element construction, dialogs, toasts, and a compact
// markdown renderer. No framework, no build step.

/**
 * el('div.card#main', { onclick, ... }, children)
 * Props: className/class, dataset, style, on* handlers, everything else is
 * either a property (when it exists on the node) or an attribute.
 */
export function el(spec, props = {}, children = []) {
  const [tagPart, ...classParts] = String(spec).split('.');
  const [tag, id] = tagPart.split('#');
  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  if (classParts.length) node.className = classParts.join(' ');

  if (Array.isArray(props) || typeof props === 'string' || props instanceof Node) {
    children = props;
    props = {};
  }

  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class' || key === 'className') {
      node.className = [node.className, value].filter(Boolean).join(' ');
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== 'list' && key !== 'form') {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }

  append(node, children);
  return node;
}

export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// --- common pieces ----------------------------------------------------------

export function section(title, { meta = null, actions = null } = {}, children = []) {
  return el('section.section', [
    el('div.section__head', [
      el('h2.section__title', { text: title }),
      el('div.section__rule'),
      meta ? el('span.section__meta', { text: meta }) : null,
      actions,
    ]),
    ...(Array.isArray(children) ? children : [children]),
  ]);
}

export function empty(title, body, action = null) {
  return el('div.empty', [
    el('div.empty__title', { text: title }),
    el('p.empty__body', { text: body }),
    action,
  ]);
}

export function meter(ratio, variant = '') {
  const pct = Math.max(0, Math.min(1, ratio || 0)) * 100;
  return el('div.meter', { role: 'presentation' }, [
    el('div.meter__fill' + (variant ? `.meter__fill--${variant}` : ''), {
      style: { width: `${pct}%` },
    }),
  ]);
}

export function tag(text, variant = '', props = {}) {
  return el('span.tag' + (variant ? `.tag--${variant}` : ''), { text, ...props });
}

export function icon(name) {
  const paths = {
    check: 'M2 6.2 4.6 9 10 2.6',
    lock: 'M3 5.2V3.6a2.6 2.6 0 0 1 5.2 0v1.6M2.2 5.2h7.6v5.2H2.2z',
    plus: 'M6 2v8M2 6h8',
    chevron: 'M4 2.5 8 6l-4 3.5',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name] || paths.check);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

export function field(label, control, { hint = null, id = null } = {}) {
  if (id) control.id = id;
  return el('label.field', [
    el('span.field__label', { text: label }),
    control,
    hint ? el('span.field__hint', { text: hint }) : null,
  ]);
}

export function input(props = {}) {
  return el('input.input', { type: 'text', ...props });
}

export function textarea(props = {}) {
  return el('textarea.textarea', props);
}

export function select(options, value, props = {}) {
  const node = el('select.select', props);
  for (const option of options) {
    const { value: v, label } = typeof option === 'string' ? { value: option, label: option } : option;
    node.appendChild(el('option', { value: v, text: label, selected: v === value }));
  }
  node.value = value ?? '';
  return node;
}

// --- toasts -----------------------------------------------------------------

let toastHost = null;

function ensureToastHost() {
  if (!toastHost) {
    toastHost = el('div.toasts', { id: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  return toastHost;
}

/**
 * @param {string} message
 * @param {{action?: {label:string, onClick:Function}, variant?: string, timeout?: number}} options
 */
export function toast(message, { action = null, variant = '', timeout = 7000 } = {}) {
  const host = ensureToastHost();
  const node = el('div.toast' + (variant ? `.toast--${variant}` : ''), [
    el('span.toast__text', { text: message }),
    action
      ? el('button.btn.btn--sm', {
          type: 'button',
          text: action.label,
          onclick: () => {
            action.onClick();
            node.remove();
          },
        })
      : null,
    el('button.btn.btn--ghost.btn--sm.btn--icon', {
      type: 'button',
      text: '✕',
      title: 'Dismiss',
      'aria-label': 'Dismiss',
      onclick: () => node.remove(),
    }),
  ]);
  host.appendChild(node);
  if (timeout) setTimeout(() => node.remove(), timeout);
  return node;
}

// --- dialogs ----------------------------------------------------------------

/**
 * Open a modal. `render` receives helpers and returns the body content.
 * Resolves with whatever `close(value)` is called with, or null on dismiss.
 */
export function openDialog({ title, body, footer, wide = false, onClose = null }) {
  return new Promise((resolve) => {
    let settled = false;
    const dialog = el('dialog' + (wide ? '.dialog--wide' : ''));

    const close = (value = null) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      onClose?.(value);
      resolve(value);
    };

    const content = typeof body === 'function' ? body(close) : body;
    const foot = typeof footer === 'function' ? footer(close) : footer;

    dialog.appendChild(
      el('div', [
        el('div.dialog__head', [
          el('h2.dialog__title', { text: title }),
          el('div.spacer'),
          el('button.btn.btn--ghost.btn--sm.btn--icon', {
            type: 'button',
            text: '✕',
            'aria-label': 'Close',
            onclick: () => close(null),
          }),
        ]),
        el('div.dialog__body', content),
        foot ? el('div.dialog__foot', foot) : null,
      ]),
    );

    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(null);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) close(null);
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    const focusable = dialog.querySelector('input, textarea, select, button.btn--primary');
    focusable?.focus();
  });
}

/**
 * Confirm step for destructive work. `danger` styles the confirm button, and
 * `extraLabel` adds a third option (used for "archive instead of delete").
 */
export function confirm({ title, message, confirmLabel = 'Confirm', extraLabel = null, danger = true }) {
  return openDialog({
    title,
    body: el('p.break', { text: message }),
    footer: (close) => [
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      extraLabel ? el('button.btn', { type: 'button', text: extraLabel, onclick: () => close('extra') }) : null,
      el('button.btn' + (danger ? '.btn--danger' : '.btn--primary'), {
        type: 'button',
        text: confirmLabel,
        onclick: () => close('confirm'),
      }),
    ],
  });
}

// --- markdown ---------------------------------------------------------------

const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => escapeMap[ch]);
}

function inlineMarkdown(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  return out;
}

/**
 * Enough markdown for notes: headings, lists, quotes, fenced code, rules,
 * paragraphs and inline emphasis. Everything is escaped before formatting, so
 * note bodies can never inject markup.
 */
export function renderMarkdown(source) {
  const lines = String(source ?? '').split('\n');
  const out = [];
  let listType = null;
  let inCode = false;
  let codeBuffer = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) {
      out.push(listType === 'ul' ? '</ul>' : '</ol>');
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (/^```/.test(line)) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
        codeBuffer = [];
        inCode = false;
      } else {
        flushParagraph();
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuffer.push(raw);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(6, heading[1].length);
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushParagraph();
      closeList();
      out.push('<hr>');
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      out.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }

    const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (task) {
      flushParagraph();
      if (listType !== 'ul') {
        closeList();
        out.push('<ul>');
        listType = 'ul';
      }
      const checked = task[1].toLowerCase() === 'x';
      out.push(
        `<li><input type="checkbox" disabled ${checked ? 'checked' : ''}> ${inlineMarkdown(task[2])}</li>`,
      );
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (listType !== 'ul') {
        closeList();
        out.push('<ul>');
        listType = 'ul';
      }
      out.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      if (listType !== 'ol') {
        closeList();
        out.push('<ol>');
        listType = 'ol';
      }
      out.push(`<li>${inlineMarkdown(numbered[1])}</li>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  if (inCode && codeBuffer.length) out.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
  flushParagraph();
  closeList();
  return out.join('\n');
}

/** Download a string as a file, with no server involved. */
export function downloadFile(filename, contents, type = 'application/json') {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return String(url || 'link').slice(0, 40);
  }
}
