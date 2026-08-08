// Stable id generation. Kept separate so tests can stub it if they need
// deterministic ids.

let counter = 0;

export function uid(prefix = 'id') {
  counter += 1;
  const rand =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export function isId(value) {
  return typeof value === 'string' && value.length > 0;
}
