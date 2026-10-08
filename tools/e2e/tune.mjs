// Đánh giá pickSpeaker (src/js/speaker.js) trên 122 ca nhận diện đo thật (tools/e2e/data, Chrome 154, 08/10/2026):
// mỗi câu mẫu được 1 recognizer đúng tiếng và 1 recognizer sai tiếng nghe; chấm cả 2 tình huống lượt.
//   node tools/e2e/tune.mjs          → điểm + các ca sai
//   node tools/e2e/tune.mjs grid     → quét hệ số (RATE, TUNE) để so đánh đổi luân phiên / nói 2 câu liền
import { readFileSync } from 'node:fs';
const M = await import('../../src/js/speaker.js'); const { pickSpeaker } = M;
const evalAll = () => {
const load = (f) => readFileSync(new URL(`data/${f}.txt`, import.meta.url), 'utf8').trim().split('\n').map((l) => { const m = l.match(/^(\S+) ← (\S+): "(.*)" \[(.*?)\]/); return { lang: m[1], clip: m[2], text: m[3], det: m[4] || null }; });
const TRUE = {
  'vi-7': 'Xin chào tôi muốn xem hồ sơ hành động khắc phục', 'vi-8': 'vui lòng cho tôi xem sổ tay chất lượng', 'vi-21': 'phiên dịch này dùng cho buổi đánh giá nhà máy',
  'vi-22': 'kho nguyên liệu nằm ở đâu', 'vi-23': 'anh cho tôi xem biên bản kiểm tra đầu vào tháng trước', 'vi-24': 'đúng rồi', 'vi-25': 'công nhân có được đào tạo về an toàn lao động không',
  'vi-26': 'chúng tôi cần lấy mẫu sản phẩm để kiểm tra', 'vi-w1': 'Xin chào tôi muốn xem hồ sơ hành động khắc phục', 'vi-w3': 'vui lòng cho tôi xem sổ tay chất lượng',
  'zh-CN-1': '请让我看一下纠正措施记录', 'zh-CN-2': '质量手册在哪里', 'zh-CN-27': '我们在仓库发现了一项不符合项', 'zh-CN-28': '是的没问题', 'zh-CN-29': '请问你们的员工培训记录在哪里',
  'ja-3': '是正措置の記録を見せてください', 'ja-4': '品質マニュアルはどこにありますか', 'ja-30': '倉庫で不適合が一件見つかりました', 'ja-31': 'はい大丈夫です', 'ja-32': '従業員の教育記録はどこにありますか',
  'ko-5': '시정 조치 기록을 보여 주세요', 'ko-6': '품질 매뉴얼은 어디에 있습니까', 'ko-33': '창고에서 부적합 사항이 하나 발견되었습니다', 'ko-34': '네 괜찮습니다', 'ko-35': '직원 교육 기록은 어디에 있습니까',
  'en-9': 'please show me the corrective action records', 'en-10': 'where is the quality manual', 'en-36': 'we found one non-conformity in the warehouse', 'en-37': 'yes no problem', 'en-38': 'where are your employee training records', 'en-w3': 'we found one non-conformity in the warehouse',
};
const P = { 'en-US': 'en', 'zh-CN': 'zh', 'ja-JP': 'ja', 'ko-KR': 'ko' };
const viOnForeign = load('vi_on_foreign');
let tot = 0, ok = 0; const fails = []; const by = { alt: [0, 0], dbl: [0, 0] };
for (const [L, f] of Object.entries(P)) {
  const lOnVi = load(`${f}_on_vi`);
  for (const turn of ['me', 'partner']) {
    // tôi nói
    for (const x of lOnVi) {
      const cands = [{ side: 'me', lang: 'vi-VN', text: TRUE[x.clip], detected: 'vi' }];
      if (x.text) cands.push({ side: 'partner', lang: L, text: x.text, detected: x.det });
      const w = pickSpeaker(cands, turn); tot++; const k = turn === 'me' ? 'alt' : 'dbl'; by[k][1]++; if (w && w.side === 'me') { ok++; by[k][0]++; } else fails.push(`[lượt ${turn}] TÔI nói ${x.clip}: chọn ${w && w.side} | partner "${x.text}"`);
    }
    // đối tác nói
    for (const x of viOnForeign.filter((v) => v.clip.startsWith(L === 'zh-CN' ? 'zh' : f + '-'))) {
      const cands = [{ side: 'partner', lang: L, text: TRUE[x.clip], detected: L === 'zh-CN' ? 'zh-CN' : f }];
      if (x.text) cands.push({ side: 'me', lang: 'vi-VN', text: x.text, detected: x.det });
      const w = pickSpeaker(cands, turn); tot++; const k = turn === 'partner' ? 'alt' : 'dbl'; by[k][1]++; if (w && w.side === 'partner') { ok++; by[k][0]++; } else fails.push(`[lượt ${turn}] ĐỐI TÁC nói ${x.clip}: chọn ${w && w.side} | vi "${x.text}"`);
    }
  }
}
return { ok, tot, by, fails }; };
if (process.argv[2] === 'grid') {
  for (const b of [1.2, 1.3, 1.5, 1.8]) for (const en of [3.5, 4.5]) for (const ja of [7, 9]) { M.TUNE.expectedBonus = b; M.RATE.en = en; M.RATE.ja = ja; const r = evalAll(); console.log(`bonus ${b} en ${en} ja ${ja}: ${r.ok}/${r.tot}  luân phiên ${r.by.alt[0]}/${r.by.alt[1]}  nói liền ${r.by.dbl[0]}/${r.by.dbl[1]}`); }
} else { const r = evalAll(); console.log(`ĐÚNG ${r.ok}/${r.tot}  luân phiên ${r.by.alt[0]}/${r.by.alt[1]}  nói liền ${r.by.dbl[0]}/${r.by.dbl[1]}`); r.fails.forEach((f) => console.log('  ' + f)); }
