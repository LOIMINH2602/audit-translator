// Test đầu-cuối màn Đối thoại 1:1 trên Chrome thật, không cần điện thoại.
//   node tools/e2e/run.mjs <en-US|zh-CN|ja-JP|ko-KR> [android]
// - Micro giả (fakemic.js): phát mẫu giọng Google TTS qua AudioContext → track đưa vào recognizer.
// - "android": giả lập Chrome Android/thiết bị chỉ cho 1 phiên nhận diện (phiên mới huỷ phiên cũ — hành vi
//   đã đo thật trên Chrome). App sẽ dò ra và chạy chế độ luân phiên.
// - Kịch bản 7 lượt: đối tác trình bày 3 đoạn ngắt quãng (ngừng 1,2s), tôi nói 2 đoạn, câu ngắn "Đúng rồi",
//   luân phiên thường, tắt màn hình 3 giây (app phải tự nghe lại), và đối tác nói tiếp sau khi đã nghe bản dịch
//   (app phải mời nói lại rồi nhận đúng).
//   Khi app "mời nói lại", người nói lặp lại 1 lần. GAP=ms đổi khoảng ngừng giữa các đoạn.
// Biến môi trường: SLOW_TTS=ms (giọng máy tiếng nước ngoài chậm, mặc định 2500; 0 = nhanh), BLOCK_GTTS=1.
// Cần: Chrome cài sẵn (đổi đường dẫn bằng biến CHROME), mạng ra Google (nhận diện + dịch + tải mẫu giọng).
// Mẫu giọng tải về tools/e2e/audio/ (không commit).

import { loadClips, readTool, runInChrome } from './chrome.mjs';

const partner = process.argv[2] || 'en-US';
const android = process.argv[3] === 'android';

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
const clips = await loadClips(SAMPLES);

// ---------- kịch bản ----------
const p = partner === 'en-US' ? 'en' : partner === 'zh-CN' ? 'zh-CN' : partner.slice(0, 2);
const gap = Number(process.env.GAP ?? 1200);
// SCRIPT='[["partner",["en-1",1200,"en-2"]]]' chạy kịch bản riêng; FULLDIAG=1 in toàn bộ nhật ký.
const script = process.env.SCRIPT ? JSON.parse(process.env.SCRIPT) : [
  ['me', 'vi-7'],
  ['partner', [`${p}-1`, gap, `${p}-2`, gap, `${p}-3`]],
  ['me', 'vi-24'],
  ['partner', `${p}-4`],
  ['hide', 3000], // tắt màn hình 3 giây giữa chừng (Lợi Minh 09/10: app báo "Chưa cấp quyền micro" rồi tắt)
  ['me', ['vi-25', gap, 'vi-23']],
  ['partner', `${p}-2`],
  ['partner', `${p}-3`],
];
const page =
  `window.__CLIPS=${JSON.stringify(clips)};\n` + readTool('fakemic.js') +
  `\nwindow.__slowTts=${Number(process.env.SLOW_TTS ?? 2500)};` +
  `\nwindow.__FULLDIAG=${Boolean(process.env.FULLDIAG)};` +
  `\nwindow.__CFG=${JSON.stringify({ partner, android, script })};\n` + readTool('e2e.js');

const result = await runInChrome(page);

if (result) {
  if (result.hiddenMs) console.log(`⚠ KHÔNG HỢP LỆ: trang bị ẩn ${result.hiddenMs}ms trong lúc chạy (cửa sổ Chrome bị thu nhỏ/che) — số đo độ trễ không đại diện điện thoại, chạy lại.`);
  console.log(`${partner} · ${android ? 'giả lập Android' : 'Chrome desktop'} · chế độ ${result.mode} · đúng ${result.score} · trễ tới lúc nghe TB: Việt→ngoại ${result.hearViToX}ms, ngoại→Việt ${result.hearXToVi}ms · phiên treo ${result.stuck}`);
  for (const s of result.steps) console.log(`  ${s.res.padEnd(13)} ${s.said.padEnd(26)} lượt ${s.turnBefore.padEnd(8)} ${s.segs}/${s.parts} đoạn · nghe ${String(s.hear ?? '-').padStart(5)}ms → ${s.got.slice(0, 260)}`);
  for (const d of result.diag) console.log('    ' + d.slice(9, 260));
  process.exit(result.steps.every((s) => s.ok || s.res === 'MỜI NÓI LẠI') ? 0 : 1);
}
process.exit(2);
