// Test đầu-cuối màn Đối thoại 1:1 trên Chrome thật, không cần điện thoại.
//   node tools/e2e/run.mjs <en-US|zh-CN|ja-JP|ko-KR> [android]
// - Micro giả (fakemic.js): phát mẫu giọng Google TTS qua AudioContext → track đưa vào recognizer.
// - "android": giả lập Chrome Android/thiết bị chỉ cho 1 phiên nhận diện (phiên mới huỷ phiên cũ — hành vi
//   đã đo thật trên Chrome). App sẽ dò ra và chạy chế độ luân phiên.
// - Kịch bản 8 lượt: luân phiên thường, câu ngắn "Đúng rồi", và 2 lần 1 người nói 2 câu liền.
//   Khi app "mời nói lại", người nói lặp lại câu đó 1 lần.
// Biến môi trường: SLOW_TTS=ms (giọng máy tiếng nước ngoài chậm, mặc định 2500; 0 = nhanh), BLOCK_GTTS=1.
// Cần: Chrome cài sẵn (đổi đường dẫn bằng biến CHROME), mạng ra Google (nhận diện + dịch + tải mẫu giọng).
// Mẫu giọng tải về tools/e2e/audio/ (không commit).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', '..');
const partner = process.argv[2] || 'en-US';
const android = process.argv[3] === 'android';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8089;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- mẫu giọng ----------
const SAMPLES = {
  'vi-7': ['vi', 'Xin chào, tôi muốn xem hồ sơ hành động khắc phục.'],
  'vi-23': ['vi', 'Anh cho tôi xem biên bản kiểm tra đầu vào tháng trước.'],
  'vi-24': ['vi', 'Đúng rồi.'],
  'vi-25': ['vi', 'Công nhân có được đào tạo về an toàn lao động không?'],
  'en-1': ['en', 'Please show me the corrective action records.'],
  'en-2': ['en', 'Where is the quality manual?'],
  'en-3': ['en', 'We found one non conformity in the warehouse.'],
  'en-4': ['en', 'Where are your employee training records?'],
  'zh-CN-1': ['zh-CN', '请让我看一下纠正措施记录。'],
  'zh-CN-2': ['zh-CN', '质量手册在哪里？'],
  'zh-CN-3': ['zh-CN', '我们在仓库发现了一项不符合项。'],
  'zh-CN-4': ['zh-CN', '请问你们的员工培训记录在哪里？'],
  'ja-1': ['ja', '是正措置の記録を見せてください。'],
  'ja-2': ['ja', '品質マニュアルはどこにありますか。'],
  'ja-3': ['ja', '倉庫で不適合が一件見つかりました。'],
  'ja-4': ['ja', '従業員の教育記録はどこにありますか。'],
  'ko-1': ['ko', '시정 조치 기록을 보여 주세요.'],
  'ko-2': ['ko', '품질 매뉴얼은 어디에 있습니까?'],
  'ko-3': ['ko', '창고에서 부적합 사항이 하나 발견되었습니다.'],
  'ko-4': ['ko', '직원 교육 기록은 어디에 있습니까?'],
};
const audioDir = join(here, 'audio');
mkdirSync(audioDir, { recursive: true });
for (const [id, [tl, text]] of Object.entries(SAMPLES)) {
  const f = join(audioDir, id + '.mp3');
  if (existsSync(f)) continue;
  const r = await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${encodeURIComponent(text)}`);
  if (!r.ok) throw new Error(`tải mẫu giọng ${id} lỗi http ${r.status}`);
  writeFileSync(f, Buffer.from(await r.arrayBuffer()));
}
const clips = {};
for (const f of readdirSync(audioDir)) if (f.endsWith('.mp3')) clips[f.slice(0, -4)] = readFileSync(join(audioDir, f)).toString('base64');

// ---------- kịch bản ----------
const p = partner === 'en-US' ? 'en' : partner === 'zh-CN' ? 'zh-CN' : partner.slice(0, 2);
const script = [['me', 'vi-7'], ['partner', `${p}-1`], ['me', 'vi-24'], ['partner', `${p}-2`], ['partner', `${p}-3`], ['me', 'vi-25'], ['me', 'vi-23'], ['partner', `${p}-4`]];
const page =
  `window.__CLIPS=${JSON.stringify(clips)};\n` + readFileSync(join(here, 'fakemic.js'), 'utf8') +
  `\nwindow.__slowTts=${Number(process.env.SLOW_TTS ?? 2500)};` +
  `\nwindow.__CFG=${JSON.stringify({ partner, android, script })};\n` + readFileSync(join(here, 'e2e.js'), 'utf8');

// ---------- server + Chrome ----------
const server = spawn(process.execPath, [join(root, 'tools', 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'audit-e2e-'));
const dbg = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  // cửa sổ Chrome bị cửa sổ khác che → trang 'hidden' → Chrome không tải <audio> (giọng Google Dịch không phát)
  '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });
let result;
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
    if (d.method === 'Runtime.exceptionThrown') console.log('LỖI JS', d.params.exceptionDetails.text, d.params.exceptionDetails.exception?.description || '');
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
  await sleep(2500);
  const r = await send('Runtime.evaluate', { expression: page, awaitPromise: true, returnByValue: true, userGesture: true, timeout: 400000 });
  result = r.result?.result?.value;
  if (!result) console.log('Không có kết quả:', JSON.stringify(r).slice(0, 800));
  ws.close();
} finally {
  chrome.kill();
  server.kill();
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true }); } catch (_) {}
}

if (result) {
  console.log(`${partner} · ${android ? 'giả lập Android' : 'Chrome desktop'} · chế độ ${result.mode} · đúng ${result.score} · trễ tới lúc nghe TB: Việt→ngoại ${result.hearViToX}ms, ngoại→Việt ${result.hearXToVi}ms · phiên treo ${result.stuck}`);
  for (const s of result.steps) console.log(`  ${s.res.padEnd(13)} ${s.said.padEnd(17)} lượt ${s.turnBefore.padEnd(8)} nghe ${String(s.hear ?? '-').padStart(5)}ms → ${s.got.slice(0, 220)}`);
  for (const d of result.diag) console.log('    ' + d.slice(9, 260));
  process.exit(result.steps.every((s) => s.ok || s.res === 'MỜI NÓI LẠI') ? 0 : 1);
}
process.exit(2);
