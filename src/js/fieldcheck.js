// Kết luận của bài "Đo tai nghe" (fieldtest.js). Thuần dữ liệu, không đụng trình duyệt → test được bằng node.
// Vì sao có bài đo (09/10/2026): mọi số đo trước đây làm trên máy tính, micro giả, không có Bluetooth. Lợi Minh
// báo dịch qua tai nghe rất chậm và tai nghe không phân biệt tai khách / tai mình. Bài đo trả lời bằng số trên
// chính điện thoại + tai nghe đó:
//   1. Tai trái/phải có tách được không — lúc micro tắt, lúc nhận diện giọng nói đang bật, lúc giữ micro điện thoại.
//   2. Mỗi lần micro tắt, tai nghe mất bao lâu mới phát được tiếng (chuyển chế độ cuộc gọi → nghe nhạc), có mất
//      tiếng đầu không. Đo bằng phản xạ: chạm khi nghe tiếng bíp, so với lúc micro chưa bật.
//   3. Chuỗi thật: dứt lời → chốt câu → dịch → máy bắt đầu đọc → người nghe nghe thấy.

export const SWITCH_SLOW_MS = 400; // chênh phản xạ sau khi tắt micro so với bình thường: trên mức này là đáng kể
export const DEFAULT_REACTION_MS = 300; // khi không đo được phản xạ gốc
export const BEEPS = 3; // số tiếng bíp mỗi lần đo phản xạ

export function median(xs) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// ears = { left, right }: tiếng bíp phát bên trái / bên phải được nghe ở 'left' | 'right' | 'both' | 'phone'
// (phát ra loa điện thoại, không ra tai nghe) | 'none' (null = không đo được).
// Trả về 'stereo' | 'swapped' | 'mono' | 'phone' | 'silent' | 'partial' | 'mixed' | 'unknown'.
export function stereoVerdict(ears) {
  if (!ears || !ears.left || !ears.right) return 'unknown';
  const { left, right } = ears;
  if (left === 'none' && right === 'none') return 'silent';
  if (left === 'phone' && right === 'phone') return 'phone';
  if (left === 'left' && right === 'right') return 'stereo';
  if (left === 'right' && right === 'left') return 'swapped';
  if (left === 'both' && right === 'both') return 'mono';
  if (['none', 'phone'].includes(left) || ['none', 'phone'].includes(right)) return 'partial';
  return 'mixed';
}

const EAR_TEXT = {
  stereo: 'tách được tai trái/phải',
  swapped: 'tách được nhưng trái/phải bị đảo (đeo ngược tai?)',
  mono: 'KHÔNG tách được — 2 tai nghe như nhau (mono)',
  phone: 'tiếng phát ra điện thoại, KHÔNG ra tai nghe',
  silent: 'KHÔNG nghe thấy gì',
  partial: 'chỉ nghe được 1 bên',
  mixed: 'kết quả không nhất quán',
  unknown: 'không đo được',
};
export const earText = (v) => EAR_TEXT[v] || v;

// trials: [{ rt (ms từ lúc phát bíp tới lúc chạm, null = không chạm), early (chạm trước khi có bíp), heard (0..BEEPS) }]
export function reactionStats(trials = []) {
  const valid = trials.filter((t) => !t.early && Number.isFinite(t.rt));
  return {
    n: trials.length,
    valid: valid.length,
    rt: median(valid.map((t) => t.rt)),
    missed: trials.filter((t) => !t.early && !Number.isFinite(t.rt)).length,
    heard: median(trials.filter((t) => !t.early).map((t) => t.heard)),
  };
}

const s1 = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' giây';

// r = {
//   output: 'bt' | 'speaker',
//   ears: { idle, mic, phone } — mỗi cái { left, right } hoặc null (không đo),
//   base: trials, afterMic: trials,
//   track: { tried, ok, text, err } — nhận diện qua micro điện thoại (start(track)),
//   chain: [{ said, out, textMs, translateMs, ttsStartMs, appMs, tapMs, early, err, engine }]
// }
// Trả về { lines: [{ level, text }], issues: [text], summary } — summary gọn để so 2 lần đo (tai nghe / loa).
export function analyze(r) {
  const lines = [];
  const issues = [];
  const add = (level, text) => lines.push({ level, text });
  const bt = r.output === 'bt';

  // ---- 1. tai trái / phải ----
  const v = {
    idle: stereoVerdict(r.ears && r.ears.idle),
    mic: stereoVerdict(r.ears && r.ears.mic),
    phone: stereoVerdict(r.ears && r.ears.phone),
  };
  if (bt) {
    const lvl = (x) => (x === 'stereo' || x === 'swapped' ? 'ok' : x === 'unknown' ? 'info' : 'bad');
    add(lvl(v.idle), `Tai trái/phải khi micro tắt: ${earText(v.idle)}`);
    add(lvl(v.mic), `Tai trái/phải khi nhận diện giọng nói đang bật: ${earText(v.mic)}`);
    add(lvl(v.phone), `Tai trái/phải khi app giữ micro điện thoại: ${earText(v.phone)}`);
    const sep = (x) => x === 'stereo' || x === 'swapped';
    if (sep(v.idle) && ['mono', 'silent', 'partial', 'phone'].includes(v.mic)) {
      const how = { mono: ' (2 tai nghe như nhau)', silent: ' và máy tắt hẳn tiếng phát ra', phone: ': tiếng chuyển ra điện thoại', partial: ' (chỉ còn 1 bên)' }[v.mic];
      issues.push(
        'Khi nhận diện giọng nói bật, âm thanh đổi chế độ' + how +
          '. Không thể cho mỗi tai nghe một người trong lúc micro bật.'
      );
    } else if (sep(v.idle) && sep(v.mic)) {
      add('ok', 'Nhận diện giọng nói không làm tai nghe chuyển chế độ cuộc gọi (nhiều khả năng đang dùng micro điện thoại).');
    } else if (v.idle === 'mono') {
      issues.push('Tai nghe/máy phát mono ngay cả khi micro tắt: không tách được tai trái/phải.');
    }
  } else {
    add('info', 'Đo bằng loa điện thoại: bỏ qua phần tai trái/phải.');
  }

  // ---- 2. trễ do chuyển chế độ âm thanh sau khi tắt micro ----
  const base = reactionStats(r.base);
  const after = reactionStats(r.afterMic);
  let switchMs = null;
  let clipped = null;
  add('info', `Phản xạ khi micro chưa bật: ${base.rt ?? '?'}ms (${base.valid}/${base.n} lần hợp lệ), nghe ${base.heard ?? '?'}/${BEEPS} tiếng bíp`);
  add('info', `Phản xạ ngay sau khi micro tắt: ${after.rt ?? '?'}ms (${after.valid}/${after.n} lần hợp lệ), nghe ${after.heard ?? '?'}/${BEEPS} tiếng bíp`);
  if (base.rt != null && after.rt != null) {
    switchMs = Math.max(0, after.rt - base.rt);
    if (switchMs >= SWITCH_SLOW_MS) {
      add('bad', `Sau mỗi lần micro tắt, phải chờ thêm ~${s1(switchMs)} mới nghe được tiếng.`);
      issues.push(
        `Mỗi lượt dịch mất thêm ~${s1(switchMs)} chỉ để ${bt ? 'tai nghe chuyển từ chế độ cuộc gọi sang phát' : 'máy chuyển chế độ âm thanh'} sau khi micro tắt.`
      );
    } else {
      add('ok', `Sau khi micro tắt, tiếng phát ra gần như ngay (chênh ${switchMs}ms — không đáng kể).`);
    }
  } else {
    add('warn', 'Không đủ lần đo phản xạ hợp lệ để tính trễ chuyển chế độ.');
  }
  if (after.missed) issues.push(`${after.missed}/${after.n} lần không nghe thấy tiếng bíp nào ngay sau khi micro tắt.`);
  if (base.heard != null && after.heard != null && after.heard < base.heard) {
    clipped = base.heard - after.heard;
    add('bad', `Ngay sau khi micro tắt, mất ${clipped} tiếng bíp đầu (nghe ${after.heard}/${BEEPS}).`);
    issues.push('Ngay sau khi micro tắt, phần đầu âm thanh bị mất: tương đương mất chữ đầu của bản dịch.');
  }

  // ---- 3. nhận diện qua micro điện thoại ----
  const t = r.track || {};
  const phoneSep = v.phone === 'stereo' || v.phone === 'swapped';
  if (t.tried) {
    add(t.ok ? 'ok' : 'warn', `Nhận diện qua micro điện thoại do app giữ: ${t.ok ? `chạy được ("${t.text}")` : 'KHÔNG chạy được' + (t.err ? ` (${t.err})` : '')}`);
  }
  const optionB = bt && t.ok && phoneSep;
  if (bt && t.tried) {
    add(optionB ? 'ok' : 'info', optionB
      ? 'Hướng B làm được: app giữ micro điện thoại, tai nghe vẫn ở chế độ nghe nhạc (tách tai, không phải chuyển chế độ mỗi lượt).'
      : 'Hướng B (giữ micro điện thoại để tai nghe khỏi chuyển chế độ) chưa làm được trên máy này.');
  }

  // ---- 4. chuỗi dịch thật ----
  const reaction = base.rt ?? DEFAULT_REACTION_MS;
  const good = (r.chain || []).filter((c) => !c.err && !c.early && Number.isFinite(c.tapMs));
  (r.chain || []).forEach((c, i) => {
    if (c.err) return add('bad', `Câu ${i + 1}: ${c.err}`);
    const hear = Number.isFinite(c.tapMs) ? Math.max(0, c.tapMs - reaction) : null;
    const tail = hear != null && Number.isFinite(c.appMs) ? Math.max(0, hear - c.appMs) : null;
    add(c.early || hear == null ? 'warn' : 'info',
      `Câu ${i + 1} "${c.said}" → "${c.out}": chốt câu ${c.textMs}ms · dịch ${c.translateMs}ms · máy bắt đầu đọc ${c.ttsStartMs ?? '?'}ms (${c.engine})` +
      (c.early ? ' · chạm trước khi máy đọc (bỏ câu này)' : hear == null ? ' · không chạm' : ` · nghe thấy sau ${s1(hear)} kể từ lúc dứt lời` + (tail == null ? '' : ` (trong đó ~${s1(tail)} là từ lúc máy đọc tới lúc ${bt ? 'tai nghe' : 'loa'} phát)`)));
  });
  let hearMs = null;
  let parts = null;
  if (good.length) {
    hearMs = median(good.map((c) => Math.max(0, c.tapMs - reaction)));
    parts = {
      text: median(good.map((c) => c.textMs)),
      translate: median(good.map((c) => c.translateMs)),
      ttsStart: median(good.map((c) => c.ttsStartMs)),
    };
    parts.tail = Math.max(0, hearMs - (median(good.map((c) => c.appMs)) ?? hearMs));
    add('info', `TỪ LÚC DỨT LỜI TỚI LÚC NGHE BẢN DỊCH: ~${s1(hearMs)} = chốt câu ${parts.text}ms + dịch ${parts.translate}ms + máy bắt đầu đọc ${parts.ttsStart ?? '?'}ms + phát ra ${bt ? 'tai nghe' : 'loa'} ~${parts.tail}ms`);
    const worst = Object.entries({ 'chốt câu (nhận diện giọng nói)': parts.text, 'dịch (mạng)': parts.translate, 'máy chuẩn bị giọng đọc': parts.ttsStart, [bt ? 'Bluetooth phát ra tai nghe' : 'phát ra loa']: parts.tail })
      .filter(([, ms]) => Number.isFinite(ms))
      .sort((a, b) => b[1] - a[1])[0];
    if (worst && hearMs > 1500) issues.push(`Dứt lời ~${s1(hearMs)} mới nghe bản dịch; chậm nhất là bước: ${worst[0]} (~${s1(worst[1])}).`);
  } else if ((r.chain || []).length) {
    issues.push('Không đo được chuỗi dịch thật (không câu nào hợp lệ).');
  }

  return {
    lines,
    issues,
    summary: { output: r.output, ears: v, reaction: base.rt, switchMs, clipped, trackOk: Boolean(t.ok), optionB, hearMs, parts },
  };
}

// So 2 lần đo (tai nghe Bluetooth vs loa điện thoại) nếu đã có cả hai.
export function compare(bt, speaker) {
  if (!bt || !speaker) return [];
  const ms = (x) => (Number.isFinite(x) ? x + 'ms' : 'chưa đo được');
  const row = (label, a, b) => `${label}: tai nghe ${ms(a)} · loa ${ms(b)}${Number.isFinite(a) && Number.isFinite(b) ? ` → tai nghe chậm hơn ${a - b}ms` : ''}`;
  return [
    row('Trễ sau khi micro tắt', bt.switchMs, speaker.switchMs),
    row('Dứt lời → nghe bản dịch', bt.hearMs, speaker.hearMs),
  ];
}
