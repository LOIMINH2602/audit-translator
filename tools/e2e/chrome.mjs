// Chạy 1 đoạn script trong trang app trên Chrome thật (CDP), dùng chung cho run.mjs (màn 1:1) và field.mjs (bài Đo tai nghe).
// Tự bật server tĩnh (tools/serve.mjs) trừ khi có BASE_URL; mỗi lần chạy 1 profile Chrome mới (localStorage trống).
// Mẫu giọng (micro giả) tải từ Google Dịch về tools/e2e/audio/ (không commit).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8089;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// samples = { id: [tl, text] } → { id: base64 mp3 } (mọi file trong thư mục audio).
export async function loadClips(samples) {
  const audioDir = join(here, 'audio');
  mkdirSync(audioDir, { recursive: true });
  for (const [id, [tl, text]] of Object.entries(samples)) {
    const f = join(audioDir, id + '.mp3');
    if (existsSync(f)) continue;
    const r = await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${encodeURIComponent(text)}`);
    if (!r.ok) throw new Error(`tải mẫu giọng ${id} lỗi http ${r.status}`);
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  const clips = {};
  for (const f of readdirSync(audioDir)) if (f.endsWith('.mp3')) clips[f.slice(0, -4)] = readFileSync(join(audioDir, f)).toString('base64');
  return clips;
}

export const readTool = (name) => readFileSync(join(here, name), 'utf8');

// Mở trang, đánh giá `page` (biểu thức trả Promise), trả về giá trị. errors: mảng lỗi JS trong trang.
export async function runInChrome(page, { errors = [], timeoutMs = 400000 } = {}) {
  const server = process.env.BASE_URL ? null : spawn(process.execPath, [join(root, 'tools', 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  const profile = mkdtempSync(join(tmpdir(), 'audit-e2e-'));
  const dbg = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    // cửa sổ Chrome bị cửa sổ khác che → trang 'hidden' → Chrome không tải <audio> (giọng Google Dịch không phát)
    '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    let ver;
    for (let i = 0; i < 150 && !ver; i++) {
      await sleep(200);
      ver = await fetch(`http://127.0.0.1:${dbg}/json/version`).then((r) => r.json()).catch(() => null);
    }
    const tgt = await fetch(`http://127.0.0.1:${dbg}/json/new?${encodeURIComponent(process.env.BASE_URL || `http://localhost:${PORT}/`)}`, { method: 'PUT' }).then((r) => r.json());
    const ws = new WebSocket(tgt.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) pending.get(d.id)(d);
      if (d.method === 'Runtime.exceptionThrown') {
        const t = `${d.params.exceptionDetails.text} ${d.params.exceptionDetails.exception?.description || ''}`;
        errors.push(t);
        console.log('LỖI JS', t);
      }
    };
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable');
    // BLOCK_GTTS=1: chặn file đọc của Google Dịch (giả lập mất mạng / Google chặn) để test đường dự phòng giọng máy
    if (process.env.BLOCK_GTTS) {
      await send('Network.enable');
      await send('Network.setBlockedURLs', { urls: ['*translate_tts*'] });
    }
    // tab chưa từng hiển thị thì Chrome hoãn tải <audio> (giọng Google Dịch không phát) → luôn đưa tab lên trước
    await send('Page.bringToFront');
    // cửa sổ test luôn ở trạng thái thường, đặt trên cùng (thu nhỏ → trang hidden)
    try {
      const w = await send('Browser.getWindowForTarget', {});
      if (w.result) await send('Browser.setWindowBounds', { windowId: w.result.windowId, bounds: { windowState: 'normal' } });
    } catch (_) {}
    await sleep(2500);
    const r = await send('Runtime.evaluate', { expression: page, awaitPromise: true, returnByValue: true, userGesture: true, timeout: timeoutMs });
    const value = r.result?.result?.value;
    if (!value) console.log('Không có kết quả:', JSON.stringify(r).slice(0, 800));
    ws.close();
    return value;
  } finally {
    chrome.kill();
    if (server) server.kill();
    await sleep(800);
    try { rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
}
