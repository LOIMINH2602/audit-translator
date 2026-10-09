// Người dùng giả cho bài "Đo tai nghe & độ trễ" (fieldtest.js): đọc mã bước (data-step) trên ô hỏi và trả lời như
// 1 tai nghe có hành vi định sẵn. window.__FCFG = { partner, android, runs: [sim, ...] }, mỗi sim:
//   output 'bt' | 'speaker'; micEars / phoneEars: tai nghe nghe thế nào khi micro bật / khi app giữ micro điện thoại
//   ('stereo' | 'mono' | 'phone'); switchMs: tai nghe chậm thêm bao lâu sau khi micro tắt (cộng vào lúc chạm);
//   clipMic: số tiếng bíp bị mất sau khi micro tắt; reactMs: phản xạ; earlyOnce: chạm sớm 1 lần (phải bị đo lại);
//   stopAt: mã bước bấm "Dừng bài đo".
// Chạy các sim nối tiếp trong cùng trang (localStorage giữ lại → lần sau có dòng "So sánh").
(async () => {
  const cfg = window.__FCFG;
  await window.__ready;
  window.__androidLike = Boolean(cfg.android);
  const tts = await import(new URL('js/tts.js', location.href).href);
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const beeps = [];
  window.__onBeep = (b) => beeps.push(b);
  // lúc âm thanh THẬT SỰ phát (giọng Google Dịch: sự kiện 'playing'; play() được gọi sớm hơn tới ~1,5 giây khi mạng chậm)
  let playingAt = 0;
  const play0 = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    this.addEventListener('playing', () => (playingAt = performance.now()), { once: true });
    return play0.call(this);
  };
  await __say([200]);
  $('tabTest').click();
  $('stPartner').value = cfg.partner;

  const LABEL = { left: 'Tai trái', right: 'Tai phải', both: 'Cả hai tai', phone: 'Phát ra điện thoại', none: 'Không nghe thấy' };
  const click = (prefix) => {
    const b = [...$('stAsk').querySelectorAll('button')].find((x) => x.textContent.startsWith(prefix));
    if (!b) throw new Error(`bước ${$('stAsk').dataset.step}: không có nút "${prefix}"`);
    b.click();
  };
  const CHAIN_CLIP = ['vi-7', 'vi-p2'];
  const out = [];

  for (const sim of cfg.runs) {
    const react = sim.reactMs ?? 280;
    const log = [];
    let earlyDone = !sim.earlyOnce;
    const seen = new WeakSet();
    $('stField').click();
    const t0 = performance.now();
    while (performance.now() - t0 < 400000 && $('stField').dataset.running) {
      const box = $('stAsk');
      const first = box.querySelector('button');
      if (!first || seen.has(first)) { await sleep(30); continue; }
      seen.add(first);
      const step = box.dataset.step || '';
      log.push(step);
      if (sim.stopAt && step === sim.stopAt) {
        $('stField').click(); // bấm "Dừng bài đo" giữa chừng (đang giữ micro)
        while ($('stField').dataset.running) await sleep(30);
        break;
      }
      let m;
      if (step === 'output') click(sim.output === 'bt' ? 'Tai nghe' : 'Loa');
      else if (step === 'reaction-intro') click('Bắt đầu');
      else if ((m = step.match(/^ear-(idle|mic|phone)-(left|right)$/))) {
        const truth = beeps[beeps.length - 1].pan < 0 ? 'left' : 'right';
        const how = m[1] === 'idle' ? 'stereo' : m[1] === 'mic' ? sim.micEars : sim.phoneEars;
        click(LABEL[how === 'stereo' ? truth : how === 'mono' ? 'both' : 'phone']);
      } else if ((m = step.match(/^tap-(base|mic)-\d$/))) {
        const n0 = beeps.length;
        if (!earlyDone && m[1] === 'base') {
          earlyDone = true;
          await sleep(300);
          click('NGHE THẤY'); // chạm trước tiếng bíp: app phải báo chạm sớm và đo lại
          continue;
        }
        while (beeps.length === n0 && $('stField').dataset.running) await sleep(10);
        if (beeps.length === n0) break;
        const b = beeps[beeps.length - 1];
        const wait = b.at + react + (m[1] === 'mic' ? sim.switchMs : 0) - performance.now();
        if (wait > 0) await sleep(wait);
        click('NGHE THẤY');
      } else if ((m = step.match(/^count-(base|mic)-\d$/))) click(`${3 - (m[1] === 'mic' ? sim.clipMic : 0)} tiếng`);
      else if (step === 'track-ready') {
        click('Bắt đầu');
        __say([1500, 'vi-num']);
      } else if ((m = step.match(/^chain-ready-(\d)$/))) {
        click('Bắt đầu');
        __say([1200, CHAIN_CLIP[Number(m[1]) - 1]]);
      } else if (step.startsWith('chain-tap-')) {
        const btn = first;
        const shown = performance.now();
        // chỉ tính tiếng đọc sau khi app đã chốt câu ("Đang dịch"): trước đó có thể là câu đọc thử không tiếng.
        // Giọng máy: speechSynthesis.speaking (giả lập Android hoãn speak() tới lúc giọng thật bắt đầu).
        const reading = () => /Đang dịch/.test(box.textContent) && (playingAt > shown || speechSynthesis.speaking);
        while (!reading() && $('stField').dataset.running && box.contains(btn)) await sleep(10);
        if (!reading()) continue; // câu lỗi (không đọc): bỏ, app tự sang bước sau
        await sleep(react + sim.switchMs);
        btn.click();
      } else throw new Error('bước lạ: ' + step + ' — ' + box.textContent.slice(0, 120));
    }
    out.push({
      sim,
      steps: log,
      summary: window.__field && window.__field.summary,
      data: window.__field && window.__field.r,
      report: $('stReport').textContent,
      running: Boolean($('stField').dataset.running),
    });
    await sleep(1000);
  }
  return out;
})()
