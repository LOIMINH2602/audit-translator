export const $ = (id) => document.getElementById(id);

export function timeNow() {
  return new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function setError(el, msg) {
  el.textContent = msg || '';
  el.hidden = !msg;
}

export function copyText(text, btn) {
  const label = btn.textContent;
  const flash = (t, ms) => {
    btn.textContent = t;
    setTimeout(() => (btn.textContent = label), ms);
  };
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
    .then(() => flash('Đã chép', 1200))
    .catch(() => flash('Không chép được', 1500));
}

// Mỗi entry: { time, tag, src, out, info }. Mới nhất trên đầu.
export function renderLog(box, entries) {
  box.textContent = '';
  for (const x of entries.slice().reverse()) {
    const div = document.createElement('div');
    div.className = 'entry';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = x.tag;
    meta.append(tag, document.createTextNode(x.time + (x.info ? ' · ' + x.info : '')));
    const o = document.createElement('div');
    o.className = 'o';
    o.textContent = x.src;
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = x.out;
    div.append(meta, o, t);
    box.appendChild(div);
  }
}

export function logToText(entries) {
  return entries.map((x) => `[${x.time} · ${x.tag}] ${x.src}\n→ ${x.out}`).join('\n\n');
}
