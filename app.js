/* EzChinese · Luyện nghe – chép. Web tĩnh: dữ liệu ở data/*.json, audio ở audio/*.mp3.
 * Tiến độ, cài đặt, hàng đợi ôn tập lưu trong localStorage của trình duyệt (không cần tài khoản). */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const view = $('#view');

// ---------------------------------------------------------------- lưu trữ
const KEY = 'ezweb.v1';
const DEFAULT_SETTINGS = { mode: 'pinyin', tilesUnit: 'word', tilesDistractors: true, strictTone: false,
                           autoplay: true, rate: 1, showMeaning: false, sfx: true, exercise: 'listen', hanViet: true, readPinyin: true,
                           bgVideo: '', bgBlur: 8, bgOpacity: 0.35, bgSound: false, bgOff: false };
let store = { settings: { ...DEFAULT_SETTINGS }, progress: {}, review: {} };
try {
  const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (raw) store = { ...store, ...raw, settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) } };
} catch { /* trình duyệt chặn lưu trữ: vẫn dùng được, chỉ không nhớ tiến độ */ }
let askedPersist = false;
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {}
  // xin trình duyệt đừng tự xoá dữ liệu khi thiếu chỗ / lâu không vào (Safari xoá sau 7 ngày nếu không xin)
  if (!askedPersist && navigator.storage?.persist) { askedPersist = true; navigator.storage.persist().catch(() => {}); }
}
const S = () => store.settings;

// ---------------------------------------------------------------- dữ liệu
const cache = {};
async function getJSON(path) {
  if (!cache[path]) cache[path] = fetch(path).then((r) => {
    if (!r.ok) throw Object.assign(new Error(path), { status: r.status });
    return r.json();
  }).catch((e) => { delete cache[path]; throw e; });   // lỗi mạng thoáng qua: lần sau tải lại
  return cache[path];
}
const loadIndex = () => getJSON('data/index.json');
let SYL = null;
async function syllables() { if (!SYL) SYL = new Set(await getJSON('data/syllables.json')); return SYL; }
/** Chữ phồn thể → giản thể ("這": "这"); tải lỗi thì chấm như cũ (chỉ nhận giản thể). */
const t2s = () => getJSON('data/t2s.json').catch(() => ({}));
/** Đồng âm không phân biệt được khi NGHE: 他 / 她 / 它 đều đọc tā → gõ chữ nào cũng nhận, kèm nhắc chữ đúng. */
const SAME_SOUND = { '他': 'ta', '她': 'ta', '它': 'ta' };

// ---------------------------------------------------------------- pinyin
const TONE_MARKS = { 'ā': 'a1', 'á': 'a2', 'ǎ': 'a3', 'à': 'a4', 'ē': 'e1', 'é': 'e2', 'ě': 'e3', 'è': 'e4',
  'ī': 'i1', 'í': 'i2', 'ǐ': 'i3', 'ì': 'i4', 'ō': 'o1', 'ó': 'o2', 'ǒ': 'o3', 'ò': 'o4',
  'ū': 'u1', 'ú': 'u2', 'ǔ': 'u3', 'ù': 'u4', 'ǖ': 'v1', 'ǘ': 'v2', 'ǚ': 'v3', 'ǜ': 'v4', 'ü': 'v0',
  'ń': 'n2', 'ň': 'n3', 'ǹ': 'n4', 'ḿ': 'm2' };

/** 'wǒ' / 'wo3' / 'wo' → {s:'wo', t:3|null}; dùng cho pinyin chuẩn của từng chữ. */
function sylOf(py) {
  let s = '', t = null;
  for (const ch of py.normalize('NFC').toLowerCase()) {
    if (TONE_MARKS[ch]) { s += TONE_MARKS[ch][0]; const n = +TONE_MARKS[ch][1]; if (n) t = n; }
    else if (/[1-5]/.test(ch)) t = +ch;
    else if (/[a-z]/.test(ch)) s += ch;
  }
  return { s, t: t ?? (s ? 5 : null) };
}

/** Chuẩn hoá pinyin người học gõ trước khi tách:
 *  - NFKC: chữ toàn độ của bộ gõ TQ ("ｎｉ３　ｈａｏ３") → chữ thường, khoảng trắng ý tự → khoảng trắng;
 *  - bàn phím Việt: dấu trăng (ă ĕ ĭ ŏ ŭ) và dấu hỏi (ả ẻ ỉ ỏ ủ) hay được gõ thay dấu thanh 3 (ǎ ě ǐ ǒ ǔ);
 *  - u: → ü (v). */
const VI_TONE3 = { 'ă': 'ǎ', 'ĕ': 'ě', 'ĭ': 'ǐ', 'ŏ': 'ǒ', 'ŭ': 'ǔ', 'ả': 'ǎ', 'ẻ': 'ě', 'ỉ': 'ǐ', 'ỏ': 'ǒ', 'ủ': 'ǔ' };
const normPinyinInput = (input) => input.normalize('NFKC').toLowerCase().normalize('NFC')
  .replace(/[ăĕĭŏŭảẻỉỏủ]/g, (c) => VI_TONE3[c]).replace(/u:/g, 'v');

/** Tách pinyin người học gõ (liền hoặc cách, có dấu / số / không dấu) thành âm tiết.
 *  hint: tập âm tiết của câu mẫu — gõ liền bị nhập nhằng (kàna = kàn·a hay kà·na; fāngàn = fāng·àn hay fān·gàn)
 *  thì ưu tiên cách tách khớp câu mẫu. Chỉ đổi cách tách chữ người học đã gõ, không biến câu sai thành đúng. */
function parseUserPinyin(input, syl, hint) {
  const out = [];
  const chunks = normPinyinInput(input).split(/[^a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹḿ1-5]+/);
  for (const chunk of chunks) {
    if (!chunk) continue;
    let base = '';
    const tones = [];               // [vị trí trong base, thanh, là số thanh?]
    for (const ch of chunk) {
      if (TONE_MARKS[ch]) { base += TONE_MARKS[ch][0]; const n = +TONE_MARKS[ch][1]; if (n) tones.push([base.length - 1, n, false]); }
      else if (/[1-5]/.test(ch)) tones.push([base.length - 1, +ch, true]);  // số thanh đứng sau âm tiết
      else base += ch;
    }
    // quy hoạch động: tách base thành ít âm tiết hợp lệ nhất; thanh là dấu hiệu ranh giới — mỗi âm tiết tối đa
    // một thanh, số thanh phải đứng cuối âm tiết (xi1an1 → xi an, fang1an4 → fang an)
    const cost = (a, b) => {
      const ts = tones.filter(([p]) => p >= a && p < b);
      return 1 + 10 * Math.max(0, ts.length - 1) + 10 * ts.filter(([p, , num]) => num && p !== b - 1).length
        - (hint && hint.has(base.slice(a, b)) ? 0.6 : 0)
        + (/^(n|m|ng|hm|hng)$/.test(base.slice(a, b)) && !hint?.has(base.slice(a, b)) ? 0.5 : 0);   // thán từ 嗯/呣 hiếm: tách sau cùng (ner = ne·r, không phải n·er)
    };
    const n = base.length, best = new Array(n + 1).fill(null);
    best[0] = { c: 0, spans: [] };
    for (let i = 0; i < n; i++) {
      if (!best[i]) continue;
      for (let L = 1; L <= 6 && i + L <= n; L++) {
        // lue / nue: bàn phím không có ü → người học gõ thế cho lüe / nüe (略, 虐); không có trong bảng âm tiết chuẩn
        if (!syl.has(base.slice(i, i + L)) && !/^[ln]ue$/.test(base.slice(i, i + L))) continue;
        const c = best[i].c + cost(i, i + L);
        if (!best[i + L] || best[i + L].c > c) best[i + L] = { c, spans: [...best[i].spans, [i, i + L]] };
      }
    }
    const spans = best[n]?.spans || [[0, n]];   // không tách được → coi cả cụm là một âm tiết (sẽ bị chấm sai)
    for (const [a, b] of spans) {
      const tone = tones.find(([p]) => p >= a && p < b);
      out.push({ s: base.slice(a, b), t: tone ? tone[1] : null });
    }
  }
  return out;
}

/** Âm tiết gõ có khớp âm tiết chuẩn: chấp nhận gõ ü thành u (nu, lu, nue, lue — bàn phím không có ü) và 儿 gõ "er". */
const sameSyl = (e, u) => e === u || (/^[nl]v/.test(e) && e.replace('v', 'u') === u) || (e === 'r' && u === 'er');
/** Âm tiết của câu mẫu (gồm cả cách gõ u thay ü) — gợi ý tách pinyin gõ liền. */
const sylHint = (exp) => new Set(exp.flatMap((e) => [e.s, e.s.replace(/^([nl])v/, '$1u'), e.s === 'r' ? 'er' : e.s]));
/** Thanh gõ có được chấp nhận. Chữ đọc nhẹ (thanh 5) nhận mọi thanh: người học hay gõ thanh từ điển
 *  (这个 ge4, 妈妈 ma1, 什么时候 hou4) — đó không phải lỗi nghe. 一 / 不 nhận cả thanh gốc lẫn thanh biến điệu. */
function toneAccepted(e, ut) {
  if (ut == null) return !S().strictTone || e.t === 5;
  if (e.t === 5) return true;
  const alt = e.ch === '一' ? [1, 2, 4] : e.ch === '不' ? [2, 4] : e.sandhi3 ? [3, 2] : [e.t];
  return alt.includes(ut);
}
/** Chữ ở vị trí i có bị biến điệu thanh 3 không: thanh 3 và chữ ngay sau (không có dấu câu xen giữa) cũng thanh 3
 *  → nghe là thanh 2 (你好 ní hǎo, 可以 kéyǐ). Người học nghe chép gõ thanh 2 là đúng với cái họ nghe. */
const sandhi3At = (sent, i) => sylOf(sent.py[i] || '').t === 3 && isHan([...sent.hz][i + 1] || '') && sylOf(sent.py[i + 1] || '').t === 3;
/** 儿 er hoá (pinyin "r"): âm cuộn lưỡi rất nhẹ — gõ thiếu cũng không tính sai. */
const isErhua = (e) => e.s === 'r';

/** Phần người học gõ thừa thật: số âm / chữ không khớp trừ đi số chữ còn thiếu (gõ sai thay vào chỗ một chữ không tính là thừa). */
const onlyExtra = (unmatched, missing) => unmatched.slice(Math.min(unmatched.length, Math.max(0, missing)));

/** LCS giữa hai dãy (so bằng hàm eq). Trả về các cặp chỉ số khớp. */
function lcsPairs(a, b, eq) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
    d[i][j] = eq(a[i], b[j]) ? d[i + 1][j + 1] + 1 : Math.max(d[i + 1][j], d[i][j + 1]);
  const pairs = []; let i = 0, j = 0;
  while (i < m && j < n) {
    if (eq(a[i], b[j])) { pairs.push([i, j]); i++; j++; }
    else if (d[i + 1][j] >= d[i][j + 1]) i++; else j++;
  }
  return pairs;
}

const isHan = (c) => /[\u4e00-\u9fff]/.test(c);
/** Tên cấp. HSK 7 / 8 / 9: đề cương gộp một khối, EzChinese chia theo độ khó từ (xem ghi chú ở trang cấp). */
const lvName = (l) => `HSK ${l}`;

/** Chấm một câu. Trả về {marks: ['ok'|'tone'|'miss'|'punct' cho từng ký tự], score, correct}. */
async function grade(sent, answer, mode) {
  const chars = [...sent.hz];
  const idx = chars.map((c, i) => (isHan(c) ? i : -1)).filter((i) => i >= 0);
  const marks = chars.map((c) => (isHan(c) ? 'miss' : 'punct'));
  if (mode === 'pinyin') {
    const exp = idx.map((i) => ({ ...sylOf(sent.py[i]), ch: chars[i], sandhi3: sandhi3At(sent, i) }));
    const user = parseUserPinyin(answer, await syllables(), sylHint(exp));
    const pairs = lcsPairs(exp, user, (e, u) => sameSyl(e.s, u.s));
    for (const [ei, ui] of pairs) marks[idx[ei]] = toneAccepted(exp[ei], user[ui].t) ? 'ok' : 'tone';
    exp.forEach((e, k) => { if (isErhua(e) && marks[idx[k]] === 'miss') marks[idx[k]] = 'ok'; });
    // phần gõ thừa; "r" cuộn lưỡi gõ thêm (wanr, nar, dianr) không tính — "r" đứng riêng không thể là chữ khác
    const used = new Set(pairs.map(([, ui]) => ui));
    const extras = onlyExtra(user.filter((u, k) => !used.has(k) && u.s !== 'r').map((u) => u.s + (u.t || '')), exp.length - pairs.length);
    const ok = marks.filter((m) => m === 'ok').length;
    return { marks, score: ok / idx.length, correct: ok === idx.length && !extras.length, extra: extras.length, extras };
  }
  const exp = idx.map((i) => chars[i]);
  const user = [...answer].filter(isHan);
  const T2S = await t2s();
  // nhận chữ phồn thể (bộ gõ Đài Loan / HK: 這個 cho 这个) và 他/她/它 (nghe như nhau) — báo lại chữ đúng trong g.alt
  const eq = (a, b) => a === b || (T2S[b] || '').includes(a) || (SAME_SOUND[a] && SAME_SOUND[a] === SAME_SOUND[b]);
  const pairs = lcsPairs(exp, user, eq);
  for (const [ei] of pairs) marks[idx[ei]] = 'ok';
  const alt = pairs.filter(([ei, ui]) => exp[ei] !== user[ui])
    .map(([ei, ui]) => ({ want: exp[ei], got: user[ui], kind: SAME_SOUND[exp[ei]] && SAME_SOUND[user[ui]] ? 'sound' : 'trad' }));
  // 儿 cuộn lưỡi (pinyin "r"): gõ thiếu hay gõ thêm (玩儿) đều không tính lỗi
  idx.forEach((i) => { if (chars[i] === '儿' && sylOf(sent.py[i] || '').s === 'r') marks[i] = 'ok'; });
  const used = new Set(pairs.map(([, ui]) => ui));
  const extras = onlyExtra(user.filter((c, k) => !used.has(k) && c !== '儿'), exp.length - pairs.length);
  const ok = marks.filter((m) => m === 'ok').length;
  return { marks, score: ok / idx.length, correct: ok === idx.length && !extras.length, extra: extras.length, extras, alt };
}

// ---------------------------------------------------------------- âm thanh
let audio = null;
/** Phát câu. Trình duyệt chặn tự phát (trình duyệt trong app Facebook/TikTok, iOS) → nút nghe hiện "Chạm để nghe". */
function play(sent, rate) {
  if (audio) audio.pause();
  audio = new Audio(sent.a);
  audio.playbackRate = rate || +S().rate || 1;
  audio.preservesPitch = true;
  const btn = $('.play'), hint = $('#tap-hint');
  const a = audio;  // sự kiện pause của câu cũ đến trễ không được tắt hiệu ứng của câu mới
  const done = (e) => {
    if (a !== audio) return;
    if (btn) btn.classList.remove('playing');
    duckBg(false);
    if (e && e.type === 'ended') audioEnded(sent);
  };
  if (btn) { btn.classList.add('playing'); btn.classList.remove('need-tap'); btn.setAttribute('aria-label', 'Nghe'); }
  if (hint) hint.hidden = true;
  audio.onended = audio.onpause = done;
  duckBg(true);
  return audio.play().then(() => true, (err) => {
    done();
    if (a !== audio) return false;
    if (err && err.name === 'NotAllowedError') {
      if (btn) { btn.classList.add('need-tap'); btn.setAttribute('aria-label', 'Chạm để nghe'); }
      if (hint) hint.hidden = false;
    } else audioEnded(sent);   // không tải được âm thanh: không để đồng hồ phản xạ chờ mãi
    return false;
  });
}

/** Phản xạ tốc độ: đồng hồ chỉ chạy khi đã nghe xong câu (+2 giây trên màn cảm ứng để chạm vào ô nhập). */
function audioEnded(sent) {
  const ss = session;
  if (!ss || ss.kind !== 'speed' || !ss.timerPending || ss.checked || ss.items[ss.i] !== sent) return;
  ss.timerPending = false;
  startTimer(timeLimit(sent, ss.mode) + (coarse() ? 2 : 0));
}

// ---------------------------------------------------------------- ôn tập ngắt quãng
const INTERVALS = [10 * 60e3, 864e5, 3 * 864e5, 7 * 864e5, 21 * 864e5];  // 10 phút, 1, 3, 7, 21 ngày
/* Mỗi câu sai chỉ lưu id + file bài chứa nó (l); nội dung câu tải lại khi ôn. Bản cũ lưu nguyên câu (s) vẫn đọc được. */
function recordReview(sent, correct, inReview, src, ex) {
  const r = store.review[sent.id];
  if (!correct) {
    const l = src || r?.l, keep = l ? {} : { s: r?.s || sent };
    store.review[sent.id] = { box: 0, due: Date.now() + INTERVALS[0], x: ex, ...(l ? { l } : {}), ...keep };   // "sẽ nhắc lại sau 10 phút"
  }
  else if (r && !inReview && r.box === 0) {   // câu sai được ôn lại ở cuối bài và đúng ngay: nhẹ tay, lên hộp 1
    store.review[sent.id] = { ...r, box: 1, due: Date.now() + INTERVALS[1] };
  }
  else if (r && inReview) {
    if (r.box + 1 >= INTERVALS.length) delete store.review[sent.id];
    else store.review[sent.id] = { ...r, box: r.box + 1, due: Date.now() + INTERVALS[r.box + 1] };
  }
  persist(); updateDue();
}
const dueIds = () => Object.keys(store.review).filter((id) => store.review[id].due <= Date.now());
async function dueItems() {
  const out = [];
  for (const id of dueIds()) {
    const r = store.review[id];
    if (r.s) { out.push(r.s); continue; }
    try {
      const sent = (await getJSON(r.l)).sentences.find((x) => x.id === id);
      if (sent) out.push({ ...sent, src: r.l }); else delete store.review[id];  // câu đã bị gỡ khỏi bài
    } catch { /* lỗi mạng: để lần sau */ }
  }
  return out;
}
function updateDue() {
  const n = dueIds().length, pill = $('#due-count');
  pill.hidden = !n; pill.textContent = n;
}

// ---------------------------------------------------------------- hiệu ứng: âm thanh ngắn + hoạt ảnh
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let actx = null;
const SFX = {  // [tần số Hz, bắt đầu sau (giây)]
  ok: [[784, 0], [1047, 0.09], [1319, 0.18]], bad: [[247, 0], [196, 0.13]], tap: [[1400, 0]],
  streak: [[1047, 0], [1568, 0.08]], finish: [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.3], [1319, 0.44]],
};
function sfx(kind) {
  if (!S().sfx || !SFX[kind]) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t0 = actx.currentTime, len = kind === 'tap' ? 0.05 : 0.3, vol = kind === 'tap' ? 0.05 : 0.13;
    for (const [f, dt] of SFX[kind]) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = kind === 'bad' ? 'triangle' : 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + dt);
      g.gain.linearRampToValueAtTime(vol, t0 + dt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + len);
      o.connect(g).connect(actx.destination);
      o.start(t0 + dt); o.stop(t0 + dt + len + 0.02);
    }
  } catch { /* trình duyệt không hỗ trợ Web Audio: bỏ qua */ }
}

// Biểu tượng nét mảnh (SVG, cùng nét 1.6px, màu theo chữ) — thay cho emoji.
const ICON_PATHS = {
  slow: '<path d="M4 15a8 8 0 0 1 16 0"/><path d="M12 15l-4-3"/><circle cx="12" cy="15" r="1"/>',
  replay: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M9 21h6"/>',
  listen: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  translate: '<path d="M4 7h10"/><path d="M9 4v3c0 4-2 7-5 8"/><path d="M7 11c1.5 2 3.5 3 6 3.5"/><path d="M13 20l4-9 4 9"/><path d="M14.5 17h5"/>',
  hint: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  talk: '<path d="M4 5h16v10H9l-5 4z"/>',
  biz: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M3 12h18"/>',
  streak: '<path d="M12 3c3 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-6 0 2 1 3 2 3 0-3 0-5 1-8z"/>',
};
const icon = (k) => `<svg class="ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[k]}</svg>`;

/** Đọc to một từ (ô ghép từ) bằng giọng tiếng Trung có sẵn của trình duyệt — ô có thể là từ bất kỳ (kể cả ô gây nhiễu)
 *  nên không dùng mp3 soạn sẵn. Không có giọng tiếng Trung → trả false để kêu "tách" như cũ. */
function sayWord(text) {
  const tts = window.speechSynthesis;
  if (!tts || !text) return false;
  const voices = tts.getVoices();
  const voice = voices.find((v) => /^zh[-_]CN/i.test(v.lang)) || voices.find((v) => /^(zh|cmn)/i.test(v.lang));
  if (voices.length && !voice) return false;   // máy không có giọng tiếng Trung
  tts.cancel();                                // bấm nhanh nhiều ô: chỉ đọc ô mới nhất
  if (audio && !audio.paused) audio.pause();   // không đọc đè lên câu mẫu
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  if (voice) u.voice = voice;
  u.rate = 0.9;
  tts.speak(u);
  return true;
}
if (window.speechSynthesis) speechSynthesis.getVoices();   // Chrome nạp danh sách giọng bất đồng bộ: gọi sớm

/** Đóng dấu son lên phần tử `host` (thẻ kết quả): chữ 对 như thầy cô phê vở. Thay cho pháo giấy. */
function stamp(host, text = '对', cls = '') {
  if (!host) return;
  host.querySelector('.stamp')?.remove();
  const el = document.createElement('span');
  el.className = `stamp ${cls}`.trim();
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = text;
  host.appendChild(el);
}

function replayAnim(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

function countUp(el, to, suffix = '', ms = 800) {
  if (!el) return;
  if (calm()) { el.textContent = to + suffix; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(to * (1 - (1 - k) ** 3)) + suffix;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Cho các phần tử vừa vẽ hiện ra lần lượt (CSS đọc --i làm độ trễ). */
function stagger(sel, cls = 'anim-in', root = view) {
  root.querySelectorAll(sel).forEach((el, i) => { el.style.setProperty('--i', Math.min(i, 16)); el.classList.add(cls); });
}

// ---------------------------------------------------------------- màn hình: trang chủ
async function home() {
  const tracksP = loadTracks();   // tải song song, không nối đuôi nhau (mạng 4G: mỗi lượt chờ ~150ms+)
  const idx = await loadIndex();
  const [tracks, todayS] = await Promise.all([tracksP, todaySentence(idx).catch(() => null)]);
  const returning = Object.keys(store.progress).length > 0;
  const today = todayCard(todayS);
  const cont = homeContinue(idx);
  // một hành động chính: người đã học → Học tiếp; người mới → Câu hôm nay (1 câu, dễ bắt đầu nhất)
  const [primary, secondary] = returning ? [cont, today] : [today, cont];
  const card = (href, cls, title, meta, done, total) => `<a class="card level-card ${cls}" href="${href}">
        <div class="lv">${title}</div><div class="meta">${meta}</div>
        <div class="meta-short">${done}/${total} bài</div>
        <div class="bar"><div style="width:${Math.round((100 * done) / total)}%"></div></div></a>`;
  view.innerHTML = `
    <section class="hero" aria-labelledby="home-title">
      <h1 id="home-title">${returning ? 'Học tiếp nào!' : 'Nghe một câu, gõ lại câu đó'}</h1>
      <p class="lead">${returning ? 'Mỗi ngày một ít: nghe, gõ, sửa tới khi đúng.' : 'Luyện phản xạ nghe tiếng Trung theo cấp HSK 3.0. Gõ pinyin, chữ Hán hoặc ghép từ — tuỳ bạn.'}</p>
      <div class="hero-grid">${primary.replace('class="', 'class="hero-primary ')}${secondary}</div>
      ${returning ? '' : '<p class="restore-line">Đã học EzChinese trên máy khác? <a href="#/backup">Khôi phục tiến độ bằng mã sao lưu</a></p>'}
    </section>
    ${habitPanel()}
    <section class="library" aria-labelledby="lib-hsk">
      <h2 class="section" id="lib-hsk">Luyện theo cấp HSK</h2>
      <div class="levels">${idx.levels.map((l) => {
        const all = [...l.grammar, ...l.topic];
        const done = all.filter((x) => store.progress[`hsk${l.level}/${x.id}`]).length;   // không đếm phản xạ tốc độ / bài đã gỡ
        return card(`#/hsk${l.level}`, '', lvName(l.level), `${l.grammar.length} bài ngữ pháp · ${l.topic.length} chủ đề · ${l.count} câu`, done, all.length);
      }).join('')}</div>
      ${tracks.length ? `<h2 class="section">Luyện theo tình huống</h2>
      <div class="levels tracks">${tracks.map((t) => card(`#/${t.id}`, 'track-card', `${icon(t.id === 'biz' ? 'biz' : 'talk')} ${esc(t.title)}`,
        `${esc(t.desc)}<br>${t.lessons.length} bài · ${t.count} câu`, t.lessons.filter((x) => store.progress[`${t.id}/${x.id}`]).length, t.lessons.length)).join('')}</div>` : ''}
    </section>`;
  stagger('.hero-grid > *, .restore-line, .habit, .section, .level-card');   // h1 + lời dẫn hiện ngay (LCP)
  maybeShowBgCoach();
}

/** Dải thói quen (khi đã học): dấu son 7 ngày + trạng thái sao lưu, gọn trong một khung. */
function habitPanel() {
  const n = Object.keys(store.progress).length, r = Object.keys(store.review).length, days = store.days || {};
  if (!n && !Object.keys(days).length) return '';
  const cells = [];
  for (let k = 6; k >= 0; k--) {
    const d = new Date(Date.now() - k * 864e5), c = days[d.toLocaleDateString('sv')] || 0;
    cells.push(`<li class="${c ? 'on' : ''}" title="${d.getDate()}/${d.getMonth() + 1}: ${c ? `${c} bài` : 'chưa học'}">
      <span class="ws-face" aria-hidden="true">${c ? '句' : ''}</span><span class="ws-day">${k ? `${d.getDate()}/${d.getMonth() + 1}` : 'Nay'}</span></li>`);
  }
  const week = Object.entries(days).filter(([k]) => Date.now() - Date.parse(k) < 7 * 864e5).reduce((s, [, c]) => s + c, 0);
  const at = store.backupAt, fresh = at && Date.now() - at < 7 * 864e5;
  return `<section class="habit" aria-label="Thói quen học">
      <div class="habit-seals"><h2 class="sub">Dấu son 7 ngày qua <span class="lead">· ${week} bài</span></h2><ol class="week">${cells.join('')}</ol></div>
      <a class="bk-chip${fresh ? ' ok' : ''}" href="#/backup">
        <span class="bk-icon" aria-hidden="true">${fresh ? '✓' : '!'}</span>
        <span><b>${fresh ? `Đã sao lưu ${new Date(at).toLocaleDateString('vi-VN')}` : 'Chưa sao lưu tiến độ'}</b>
          <small>${n} bài${r ? ` · ${r} câu ôn` : ''} chỉ lưu trên trình duyệt này</small></span></a>
    </section>`;
}

// ---------------------------------------------------------------- màn hình: mảng theo tình huống (giao tiếp, công sở)
const loadTracks = () => getJSON('data/tracks.json').then((d) => d.tracks || []).catch(() => []);

async function trackPage(id) {
  const t = (await loadTracks()).find((x) => x.id === id);
  if (!t) { view.innerHTML = '<p class="empty">Chưa có dữ liệu mảng này.</p>'; return; }
  const key = (x) => `${id}/${x.id}`;
  const nameOf = (x) => x.title.split(' · ')[0];
  const partOf = (x) => { const r = x.title.split(' · ').slice(1).join(' · '); return r ? r[0].toUpperCase() + r.slice(1) : 'Bài chính'; };
  const next = t.lessons.find((x) => !store.progress[key(x)]);
  const started = t.lessons.some((x) => store.progress[key(x)]);
  const row = (x, i = 0) => {
    // dòng chính: câu mở đầu của bài (biết ngay bài nói về gì), dòng phụ: phần + cấp HSK / số từ chuyên ngành
    const part = partOf(x).replace(/^(\d+)$/, 'Bài $1');
    const main = x.preview ? `“${esc(x.preview)}”` : esc(part);
    const sub = [x.preview ? part : '', x.n_terms ? `${x.n_terms} từ chuyên ngành` : '', x.subtitle.length < 12 ? x.subtitle : ''].filter(Boolean).join(' · ');
    return lessonRow(`#/${id}/${x.id}`, i, main, esc(sub), store.progress[key(x)], x.count);
  };
  view.innerHTML = `
    <div class="practice-head"><a class="back" href="#/">← Trang chủ</a></div>
    <h1>${esc(t.title)}</h1>
    <p class="lead">${esc(t.desc)}</p>
    ${next ? `<a class="continue" href="#/${id}/${next.id}">
      <span class="c-label">${started ? 'Học tiếp' : 'Bắt đầu'}</span>
      <span class="c-main">${esc(next.title)}</span>
      <span class="c-go" aria-hidden="true">→</span></a>` : ''}
    ${groupedList(t.lessons, nameOf, row, next?.id, (x) => !!store.progress[key(x)])}
    ${t.credit ? `<p class="credit">${esc(t.credit)} — <a href="https://tatoeba.org" target="_blank" rel="noopener">tatoeba.org</a></p>` : ''}`;
  stagger('.continue, .lesson-block');
}

// ---------------------------------------------------------------- giữ bài đang làm (tải lại trang / chuyển app không mất)
const RESUME_KEY = 'ezweb.resume';
function saveResume(ss) {
  if (!ss || ss.kind !== 'lesson') return;
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ key: ss.key, at: Date.now(), i: ss.i, base: ss.base,
      ids: ss.items.map((x) => x.id), retried: [...ss.retried], exercise: ss.exercise, mode: ss.mode,
      results: ss.results.map((r) => ({ id: r.sent.id, outcome: r.outcome, correct: r.correct, score: r.score })) }));
  } catch { /* trình duyệt chặn lưu trữ: bỏ qua */ }
}
function clearResume() { try { localStorage.removeItem(RESUME_KEY); } catch {} }
function loadResume(key) {
  try {
    const r = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null');
    if (r && r.key === key && Date.now() - r.at < 864e5 && r.i > 0 && r.i < r.ids.length) return r;
  } catch {}
  return null;
}
/** Bắt đầu bài: nếu đang làm dở (trong 1 ngày) thì hỏi học tiếp hay làm lại từ đầu. */
function beginLesson(ss, sentences) {
  const saved = loadResume(ss.key);
  const fresh = () => { clearResume(); session = ss; renderItem(); };
  if (!saved) return fresh();
  const byId = new Map(sentences.map((x) => [x.id, x]));
  if (!saved.ids.every((id) => byId.has(id))) return fresh();   // dữ liệu bài đã đổi
  view.innerHTML = `<div class="card resume anim-in">
      <h1 class="resume-title">${esc(ss.title)}</h1>
      <p>Bạn đang làm dở bài này, tới câu <b>${Math.min(saved.i + 1, saved.base || saved.ids.length)}/${saved.base || saved.ids.length}</b>.</p>
      <div class="actions"><button class="btn primary" id="btn-resume">Tiếp tục câu ${Math.min(saved.i + 1, saved.base || saved.ids.length)}</button>
        <button class="btn" id="btn-restart">Làm lại từ đầu</button></div></div>`;
  $('#btn-resume').onclick = () => {
    Object.assign(ss, { items: saved.ids.map((id) => byId.get(id)), i: saved.i, base: saved.base, retried: new Set(saved.retried),
      exercise: saved.exercise || ss.exercise, mode: saved.mode || ss.mode,
      results: saved.results.map((r) => ({ ...r, sent: byId.get(r.id), marks: [] })) });
    session = ss; renderItem();
  };
  $('#btn-restart').onclick = fresh;
  $('#btn-resume').focus();
}

async function startTrackLesson(track, id) {
  const src = `data/${track}-${id}.json`, les = await getJSON(src);
  beginLesson({ kind: 'lesson', key: `${track}/${id}`, src, title: les.title, level: les.level, items: shuffle(les.sentences),
                glossary: les.glossary || [], i: 0, results: [], retried: new Set(), mode: S().mode, back: `#/${track}` }, les.sentences);
}

/** Mã câu → file bài chứa câu. HSK: "1-g-G1-06-6b318686" → hsk1/g-G1-06; mảng: "talk-greet-1-…" → talk/greet-1. */
function lessonOf(id) {
  let m = id.match(/^(\d+)-(.+)-[0-9a-z]+$/);   // đuôi mã câu: số thứ tự hoặc mã băm
  if (m) return { src: `data/hsk${m[1]}-${m[2]}.json`, key: `hsk${m[1]}/${m[2]}` };
  m = id.match(/^(talk|biz)-(.+)-[0-9a-z]+$/);
  if (m) return { src: `data/${m[1]}-${m[2]}.json`, key: `${m[1]}/${m[2]}` };
  return null;
}
/** Luyện đúng một câu (câu hôm nay / câu trong video), xong thì mời học cả bài chứa câu đó. */
async function startSingle(id, today) {
  const f = lessonOf(id);
  if (!f) throw new Error(`không có câu ${id}`);
  const les = await getJSON(f.src), sent = les.sentences.find((x) => x.id === id);
  if (!sent) throw new Error(`không có câu ${id}`);
  session = { kind: 'single', key: 'single', today, src: f.src, title: today ? 'Câu hôm nay' : 'Câu trong video', level: sent.lv,
              items: [sent], i: 0, results: [], retried: new Set(), mode: S().mode, back: '#/', lessonKey: f.key, lessonTitle: les.title };
  renderItem();
}
/** Câu hôm nay: mỗi ngày một câu cố định (theo ngày), ở cấp người học đang học (mặc định HSK 1). */
async function todaySentence(idx) {
  const recent = Object.entries(store.progress).filter(([k]) => /^hsk\d+\//.test(k)).sort((a, b) => (b[1].at || 0) - (a[1].at || 0))[0];
  const level = recent ? +recent[0].slice(3, recent[0].indexOf('/')) : 1;
  if (!idx.levels.some((l) => l.level === level)) return null;
  const pool = (await getJSON(`data/hsk${level}-today.json`)).sentences;
  const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / 864e5);
  return { level, sent: pool[(day * 7919) % pool.length] };
}
function todayCard(t) {
  if (!t) return '';
  const done = store.todayDone === new Date().toLocaleDateString('sv');
  const n = [...t.sent.hz].filter(isHan).length;
  return `<a class="today${done ? ' done' : ''}" href="#/s/${encodeURIComponent(t.sent.id)}?today=1">
      <span class="t-seal" aria-hidden="true">${done ? '对' : '句'}</span>
      <span class="t-body"><span class="t-label">Câu hôm nay · ${lvName(t.level)}${done ? ' · đã làm' : ''}</span>
        <span class="t-vi">${esc(t.sent.vi)}</span>
        <span class="t-hint">Nghe và gõ lại câu tiếng Trung · ${n} chữ</span></span>
      <span class="c-go" aria-hidden="true">→</span></a>`;
}

/** Trang Sao lưu & khôi phục: mã văn bản, dán sang máy khác để gộp tiến độ. */
function backupPage() {
  const n = Object.keys(store.progress).length, r = Object.keys(store.review).length;
  view.innerHTML = `
    <div class="practice-head"><a class="back" href="#/">← Trang chủ</a></div>
    <h1>Sao lưu &amp; khôi phục tiến độ</h1>
    <p class="lead">EzChinese không cần tài khoản: bài đã học, câu cần ôn và cài đặt chỉ lưu trên trình duyệt này. Trình duyệt trong Facebook / TikTok, chế độ ẩn danh hay xoá dữ liệu trình duyệt đều có thể làm mất. Hãy chép <b>mã sao lưu</b> và cất vào Zalo / ghi chú.</p>
    <section class="card bk-section">
      <h2 class="sub">1. Sao lưu trên máy này</h2>
      <p>Hiện có <b>${n}</b> bài đã học và <b>${r}</b> câu đang ôn.${store.backupAt ? ` Lần sao lưu cuối: ${new Date(store.backupAt).toLocaleString('vi-VN')}.` : ''}</p>
      <button class="btn primary" id="bk-copy">Sao chép mã sao lưu</button>
      <textarea class="text-input bk-code" id="bk-code" rows="3" readonly hidden aria-label="Mã sao lưu"></textarea>
      <p class="field-hint" id="bk-hint" aria-live="polite"></p>
    </section>
    <section class="card bk-section">
      <h2 class="sub">2. Khôi phục trên máy khác</h2>
      <p>Dán mã (bắt đầu bằng <code>EZ1.</code>) vào ô dưới. Tiến độ được <b>gộp</b>, không ghi đè: mỗi bài giữ điểm cao nhất.</p>
      <textarea class="text-input bk-code" id="bk-input" rows="3" spellcheck="false" placeholder="EZ1.…" aria-label="Dán mã sao lưu"></textarea>
      <button class="btn" id="bk-restore">Khôi phục từ mã</button>
      <p class="field-hint" id="bk-hint2" aria-live="polite"></p>
    </section>`;
  $('#bk-copy').onclick = async () => {
    const code = await backupCode(), box = $('#bk-code');
    box.hidden = false; box.value = code; box.select();
    store.backupAt = Date.now(); persist();
    try { await navigator.clipboard.writeText(code); $('#bk-hint').textContent = '✓ Đã sao chép mã. Dán vào Zalo / ghi chú để giữ.'; }
    catch { $('#bk-hint').textContent = 'Bôi đen mã ở ô trên rồi sao chép thủ công.'; }
  };
  $('#bk-restore').onclick = async () => {
    try {
      const d = await readBackup($('#bk-input').value);
      mergeBackup(d);
      $('#bk-hint2').textContent = `✓ Đã gộp ${Object.keys(d.progress || {}).length} bài và ${Object.keys(d.review || {}).length} câu ôn vào trình duyệt này.`;
      $('#bk-input').value = '';
    } catch { $('#bk-hint2').textContent = '✗ Mã không hợp lệ — kiểm tra đã sao chép đủ chưa (mã bắt đầu bằng EZ1.).'; }
  };
}

/** Khung video nền (nút ▶ trên thanh trên cùng): dán link, phát, chỉnh mờ / rõ / tiếng, tắt — ngay tại chỗ. */
const dlgBg = $('#dlg-bg');
function bgOn() { return !S().bgOff && !!(S().bgVideo || siteBg); }
function syncBgButton() {
  const b = $('#btn-bg');
  b.classList.toggle('on', bgOn());
  b.classList.toggle('new', !store.bgSeen && !bgOn());
  b.setAttribute('aria-label', bgOn() ? 'Video nền: đang phát' : 'Video nền');
}
function openBgDialog() {
  store.bgSeen = true; store.bgCoachOff = true; persist();
  hideBgCoach(); syncBgButton();
  $('#bgd-url').value = S().bgVideo || '';
  $('#bgd-blur').value = S().bgBlur; $('#bgd-opacity').value = S().bgOpacity; $('#bgd-sound').checked = !!S().bgSound;
  const presets = (siteMeta.bg_presets || []).filter((x) => parseYouTube(x.url)).slice(0, 6);
  $('#bgd-presets').innerHTML = presets.map((x) => `<button type="button" class="chip" data-bg="${esc(x.url)}">${esc(x.title)}</button>`).join('');
  $('#bgd-presets').hidden = !presets.length;
  $('#bgd-presets').querySelectorAll('[data-bg]').forEach((c) => c.onclick = () => { $('#bgd-url').value = c.dataset.bg; playBg(); });
  bgDialogState('');
  dlgBg.showModal();
  if (!bgOn()) $('#bgd-url').focus();
}
function bgDialogState(msg) {
  $('#bgd-ctrl').hidden = !bgOn();
  $('#bgd-hint').textContent = msg || (bgOn() ? '● Đang phát. Chỉnh cho vừa mắt bên dưới.' : '');
  syncBgButton();
}
function playBg() {
  const url = $('#bgd-url').value.trim();
  if (!parseYouTube(url)) { $('#bgd-hint').textContent = '✗ Chưa phải link YouTube — thử dán link dạng youtu.be/… hoặc youtube.com/watch?v=…'; return; }
  store.settings.bgVideo = url; store.settings.bgOff = false; persist(); applyBg();
  bgDialogState('✓ Đang phát! Video sẽ hiện mờ phía sau trang sau vài giây.');
}
$('#btn-bg').onclick = openBgDialog;
$('#bgd-play').onclick = playBg;
$('#bgd-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); playBg(); } });
$('#bgd-blur').addEventListener('input', (e) => { store.settings.bgBlur = +e.target.value; persist(); applyBg(); });
$('#bgd-opacity').addEventListener('input', (e) => { store.settings.bgOpacity = +e.target.value; persist(); applyBg(); });
$('#bgd-sound').addEventListener('change', (e) => { store.settings.bgSound = e.target.checked; persist(); applyBg(); });
$('#bgd-off').onclick = () => { store.settings.bgOff = true; persist(); applyBg(); bgDialogState('Đã tắt video nền. Dán link khác để bật lại.'); };
$('#bgd-close').onclick = () => dlgBg.close();
// bấm ra ngoài để đóng: closedby="any" (Chrome/Edge/Firefox); Safari chưa hỗ trợ → tự bắt cú bấm vào nền
if (!('closedBy' in HTMLDialogElement.prototype)) dlgBg.addEventListener('click', (e) => { if (e.target === dlgBg) dlgBg.close(); });

/** Bong bóng gợi ý dưới nút video nền — chỉ ở trang chủ, cho tới khi người học thử hoặc bấm "Để sau". */
let coachTimer = null;
function maybeShowBgCoach() {
  clearTimeout(coachTimer);
  if (store.bgCoachOff || bgOn()) return;
  coachTimer = setTimeout(() => { if (!location.hash.replace(/^#\/?/, '') && !dlg.open && !dlgBg.open) $('#bg-coach').hidden = false; }, 1200);
}
function hideBgCoach() { clearTimeout(coachTimer); $('#bg-coach').hidden = true; }
$('#coach-try').onclick = openBgDialog;
$('#coach-later').onclick = () => { store.bgCoachOff = true; persist(); hideBgCoach(); };

/** Trang chủ: tiếp bài sau bài vừa học gần nhất; người mới: bài đầu tiên của HSK 1. */
function homeContinue(idx) {
  const order = (lv) => [...lv.grammar, ...lv.topic].map((x) => ({ ...x, key: `hsk${lv.level}/${x.id}`, lv: lv.level }));
  const all = idx.levels.flatMap(order);
  const recent = Object.entries(store.progress).filter(([k]) => /^hsk\d+\//.test(k) && !k.endsWith('/speed'))
    .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))[0];
  let n, label;
  if (recent) {
    const i = all.findIndex((x) => x.key === recent[0]);
    n = all.slice(i + 1).concat(all.slice(0, i)).find((x) => !store.progress[x.key]);
    label = 'Học tiếp';
  } else { n = all[0]; label = 'Mới bắt đầu? Học bài đầu tiên'; }
  if (!n) return '';
  return `<a class="continue" href="#/${n.key}">
      <span class="c-label">${label} · ${lvName(n.lv)}</span>
      <span class="c-main">${n.point ? `<span class="pt">${esc(n.point)}</span> ` : ''}${esc(n.title)}</span>
      <span class="c-go" aria-hidden="true">→</span></a>`;
}

/** Điểm ngữ pháp dạng công thức (动词+错/懂…, 动宾式离合词：…, （2）…) khó đọc với người mới → để làm dòng phụ. */
const isPattern = (pt) => /[+：:…]|^[（(]/.test(pt || '');

/** Danh sách bài chia nhóm thu gọn được; chỉ mở sẵn nhóm chứa bài tiếp theo (hoặc mọi nhóm khi ít bài). */
function groupedList(items, nameOf, row, nextId, doneOf) {
  const groups = [];
  for (const x of items) {
    const g = nameOf(x) || '';
    if (!groups.length || groups[groups.length - 1].name !== g) groups.push({ name: g, items: [] });
    groups[groups.length - 1].items.push(x);
  }
  const rows = (g) => `<ol class="lrows">${g.items.map((x, i) => `<li>${row(x, i)}</li>`).join('')}</ol>`;
  if (groups.length === 1 && !groups[0].name) return `<div class="lesson-block flat">${rows(groups[0])}</div>`;
  const openAll = items.length <= 8;
  return groups.map((g) => {
    const done = g.items.filter(doneOf).length, pct = Math.round((100 * done) / g.items.length);
    const open = openAll || g.items.some((x) => x.id === nextId) || (!nextId && g === groups[0]);
    return `<details class="lesson-block"${open ? ' open' : ''}>
      <summary><span class="b-head"><h2 class="group">${esc(g.name)}</h2>
        <span class="b-meta">${g.items.length} bài · đã làm ${done}</span></span>
        <span class="b-bar" aria-hidden="true"><i style="width:${pct}%"></i></span></summary>
      ${rows(g)}</details>`;
  }).join('');
}

/** Một dòng bài trong khối: số thứ tự · tên + dòng phụ · trạng thái (dấu son nhỏ khi ≥ 90%). */
function lessonRow(href, i, main, sub, p, count) {
  const status = p ? `${p.best >= 0.9 ? '<span class="mini-seal" aria-hidden="true">对</span>' : ''}<b>${Math.round(p.best * 100)}%</b>`
    : `<span class="cnt">${count} câu</span>`;
  return `<a class="lesson lrow${p ? ' done' : ''}" href="${href}">
      <span class="ln" aria-hidden="true">${i + 1}</span>
      <span class="lt">${main}</span><span class="ls">${sub}</span>
      <span class="lstat">${status}</span></a>`;
}

// ---------------------------------------------------------------- màn hình: danh sách bài của một cấp
async function levelPage(level, tab) {
  const idx = await loadIndex();
  const lv = idx.levels.find((l) => l.level === level);
  if (!lv) { view.innerHTML = '<p class="empty">Chưa có dữ liệu cấp này.</p>'; return; }
  tab = tab || 'grammar';
  const tabs = [['grammar', 'Theo ngữ pháp'], ['topic', 'Theo chủ đề'], ['speed', 'Phản xạ tốc độ']];
  const row = (x, i = 0) => {
    const pat = isPattern(x.point);   // công thức dài: tên tiếng Việt lên trước, công thức chữ Hán làm dòng phụ
    return lessonRow(`#/hsk${level}/${x.id}`, i,
      x.point && !pat ? `<span class="pt">${esc(x.point)}</span>` : esc(x.title),
      pat ? `<span class="pt-sm">${esc(x.point)}</span>` : esc(x.point ? x.title : x.subtitle),
      store.progress[`hsk${level}/${x.id}`], x.count);
  };
  // bài ngữ pháp: nhóm theo loại (Động từ, Phó từ…), giữ thứ tự đề cương
  const list = (items) => groupedList(items, (x) => x.group, row, nextOf(items)?.id,
    (x) => !!store.progress[`hsk${level}/${x.id}`]);
  const nextOf = (items) => items.find((x) => !store.progress[`hsk${level}/${x.id}`]);
  const cont = (items) => {
    const n = nextOf(items);
    if (!n) return `<p class="lead all-done"><span class="mini-seal" aria-hidden="true">对</span> Đã làm hết các bài của mục này.</p>`;
    const started = items.some((x) => store.progress[`hsk${level}/${x.id}`]);
    return `<a class="continue" href="#/hsk${level}/${n.id}">
      <span class="c-label">${started ? 'Học tiếp' : 'Bắt đầu'}</span>
      <span class="c-main">${n.point ? `<span class="pt">${esc(n.point)}</span> ` : ''}${esc(n.title)}</span>
      <span class="c-go" aria-hidden="true">→</span></a>`;
  };
  const speed = `<div class="card speed-card">
      <b>Phản xạ tốc độ · ${lvName(level)}</b>
      <span class="lead" style="margin:0">10 câu, ngắn → dài, tốc độ đọc tăng dần, có đồng hồ đếm ngược. Hết giờ sẽ tự chấm.</span>
      <div><a class="btn primary" href="#/hsk${level}/speed" style="display:inline-block;text-decoration:none">Bắt đầu</a></div>
      ${store.progress[`hsk${level}/speed`] ? `<span class="lead" style="margin:0">Kỷ lục: ${Math.round(store.progress[`hsk${level}/speed`].best * 100)}%</span>` : ''}
    </div>`;
  view.innerHTML = `
    <div class="practice-head"><a class="back" href="#/">← Các cấp</a></div>
    <h1>${lvName(level)}</h1>
    ${level >= 7 ? `<p class="lead lv-note">Đề cương HSK 3.0 gộp 7–9 thành một khối. EzChinese chia theo độ khó của từ: HSK 7 dễ nhất, HSK 9 khó nhất.</p>` : ''}
    <div class="tabs" role="tablist">${tabs.map(([k, n]) =>
      `<button class="tab" role="tab" aria-selected="${k === tab}" data-tab="${k}">${n}</button>`).join('')}</div>
    ${tab === 'speed' ? speed : cont(lv[tab]) + list(lv[tab])}`;
  stagger('.continue, .lesson-block, .speed-card');
  view.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { history.replaceState(null, '', `#/hsk${level}?tab=${b.dataset.tab}`); levelPage(level, b.dataset.tab); });
}

// ---------------------------------------------------------------- màn hình: luyện tập
let session = null;

function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

async function startLesson(level, id) {
  if (id === 'speed') return startSpeed(level);
  const src = `data/hsk${level}-${id}.json`, les = await getJSON(src);
  beginLesson({ kind: 'lesson', key: `hsk${level}/${id}`, src, title: les.title, level, items: shuffle(les.sentences),
                i: 0, results: [], retried: new Set(), mode: S().mode, back: `#/hsk${level}` }, les.sentences);
}

async function startSpeed(level) {
  const src = `data/hsk${level}-speed.json`, pool = (await getJSON(src)).sentences;
  const items = [];
  for (let k = 0; k < 10; k++) {  // câu thứ k lấy ngẫu nhiên trong đoạn k/10 của danh sách (ngắn → dài)
    const a = Math.floor(pool.length * k / 10), b = Math.max(a + 1, Math.floor(pool.length * (k + 1) / 10));
    items.push(pool[a + Math.floor(Math.random() * (b - a))]);
  }
  session = { kind: 'speed', key: `hsk${level}/speed`, src, title: `Phản xạ tốc độ · ${lvName(level)}`, level, items,
              i: 0, results: [], retried: new Set(), mode: S().mode, back: `#/hsk${level}?tab=speed`, streak: 0, bestStreak: 0 };
  renderItem();
}

async function startReview() {
  const items = shuffle(await dueItems());
  persist(); updateDue();
  if (!items.length) {
    const total = Object.keys(store.review).length;
    view.innerHTML = `<h1>Ôn câu sai</h1><div class="card empty">${total
      ? `Chưa đến hạn ôn. Bạn có ${total} câu đang chờ — quay lại sau nhé.`
      : 'Chưa có câu nào cần ôn. Câu bạn làm sai sẽ tự vào đây và được nhắc lại sau 10 phút, 1 ngày, 3 ngày, 7 ngày, 21 ngày.'}</div>`;
    return;
  }
  session = { kind: 'review', key: 'review', title: 'Ôn câu sai', level: 0, items: items.slice(0, 20), i: 0,
              results: [], retried: new Set(), mode: S().mode, back: '#/' };
  renderItem();
}

const speedRate = (k) => [0.9, 0.95, 1, 1, 1.05, 1.1, 1.1, 1.15, 1.2, 1.25][k] || 1.25;
const timeLimit = (sent, mode) => 4 + 0.9 * [...sent.hz].filter(isHan).length + (mode === 'tiles' ? 3 : mode === 'hanzi' ? 4 : 0);

let timerHandle = null;
function stopTimer() { if (timerHandle) cancelAnimationFrame(timerHandle); timerHandle = null; }

async function tilesFor(sent) {
  const unit = S().tilesUnit;
  let tiles = unit === 'char' ? [...sent.hz].filter(isHan) : [...sent.w];
  if (S().tilesDistractors) {
    const vocab = (await getJSON('data/vocab.json'))[sent.lv] || [];
    const have = new Set(tiles);
    const extra = shuffle(vocab.filter((w) => !have.has(w) && (unit === 'char' ? w.length === 1 : true))).slice(0, 2);
    tiles = tiles.concat(unit === 'char' ? extra.map((w) => w[0]) : extra);
  }
  return shuffle(tiles);
}

async function renderItem() {
  stopTimer();
  const ss = session, sent = ss.items[ss.i];
  ss.base ??= ss.items.length;
  saveResume(ss);
  ss.exercise = ss.kind === 'speed' ? 'listen'
    : ss.kind === 'review' && !ss.exPinned ? (store.review[sent.id]?.x || S().exercise)   // ôn đúng dạng bài đã sai
    : (ss.exercise || S().exercise);
  if (ss.exercise === 'read' && !canRead()) ss.exercise = 'listen';   // trình duyệt không nhận giọng: ôn bằng nghe chép
  ss.exPinned = false;
  ss.tries = 0; ss.lastAnswer = ''; ss.timedOut = false;
  stopMic(true);
  if (ss.exercise === 'translate') return renderTranslate();
  if (ss.exercise === 'read') return renderRead();
  const n = [...sent.hz].filter(isHan).length;
  const rate = ss.kind === 'speed' ? speedRate(ss.i) : +S().rate;
  const modeBtn = (m, label) => `<button data-mode="${m}" aria-pressed="${ss.mode === m}">${label}</button>`;
  view.innerHTML = `
    <div class="practice-head">
      <a class="back" href="${ss.back}">← Thoát</a>
      <h1 class="title">${esc(ss.title)}</h1>${countBadge(ss)}
      ${practiceOptions(ss, modeBtn)}
    </div>
    <div class="progress"><div id="progress-bar" style="width:${progressPct(ss, false)}%"></div></div>
    ${ss.kind === 'speed' ? '<div class="timer"><div id="timer-bar" style="width:100%"></div></div>' : ''}
    ${ss.glossary?.length ? `<details class="glossary"><summary>Từ chuyên ngành của bài (${ss.glossary.length})</summary>
      <div>${ss.glossary.map((g) => `<span class="term"><b>${esc(g.hanzi)}</b> ${esc(g.pinyin.replace(/ /g, ''))} · ${esc(g.meaning_vi)}</span>`).join('')}</div></details>` : ''}
    <div class="player">
      ${ss.kind === 'speed' ? '' : `<button class="small-btn" id="btn-slow" title="Nghe chậm">${icon('slow')} Chậm</button>`}
      <button class="play" id="btn-play" aria-label="Nghe">▶</button>
      <button class="small-btn" id="btn-replay" title="Nghe lại (Esc)">${icon('replay')} Nghe lại</button>
    </div>
    <p class="tap-hint" id="tap-hint" hidden>Chạm nút son để nghe câu</p>
    <div class="hint-line">${ss.kind === 'speed' ? `Tốc độ ${rate}× · ` : ''}Câu có ${n} chữ${ss.kind === 'speed' ? '<br><span class="muted">Đồng hồ chạy khi nghe xong câu</span>' : ''}</div>
    <div class="slots" aria-hidden="true">${Array.from({ length: n }, (_, j) => `<span style="--j:${j}"></span>`).join('')}</div>
    <div id="retry" class="retry" aria-live="polite"></div>
    ${ss.combo >= 2 ? `<div class="combo">${icon('streak')} ${ss.combo} câu đúng liên tiếp</div>` : ''}
    ${S().showMeaning ? `<div class="meaning">${esc(sent.vi)}</div>` : ''}
    <div id="input-area"></div>
    <div class="actions"><button class="btn primary" id="btn-check">Kiểm tra <kbd>Enter</kbd></button>
      <button class="btn" id="btn-skip">Không nghe ra</button></div>
    <p class="keys">Phím tắt: <kbd>Enter</kbd> kiểm tra · <kbd>Esc</kbd> nghe lại · <kbd>Shift</kbd>+<kbd>Esc</kbd> nghe chậm · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> xem đáp án</p>
    <div id="result" aria-live="polite"></div>`;

  stagger('.player, .hint-line, .meaning, #input-area, .actions', 'slide-in');
  bindExerciseSwitch(ss);
  // ô chữ tô dần theo số chữ / âm tiết đã gõ
  const slots = [...view.querySelectorAll('.slots span')];
  const fillSlots = (k) => slots.forEach((el, j) => el.classList.toggle('filled', j < k));
  syllables().catch(() => {});

  view.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => {
    ss.mode = b.dataset.mode;
    if (!ss.checked) { renderItem(); return; }
    // đã chấm câu này rồi: đổi cách nhập áp dụng từ câu tiếp theo (vẽ lại lúc này sẽ kẹt ở trạng thái "đã chấm")
    view.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    syncChip(ss);
  });
  $('#btn-play').onclick = () => play(sent, rate);
  $('#btn-replay').onclick = () => play(sent, rate);
  if ($('#btn-slow')) $('#btn-slow').onclick = () => play(sent, 0.7);
  $('#btn-check').onclick = () => check();
  $('#btn-skip').onclick = () => check(true);

  const area = $('#input-area');
  if (ss.mode === 'tiles') {
    const tiles = await tilesFor(sent);
    ss.chosen = [];
    area.innerHTML = `<div class="tiles-answer" id="tiles-answer" aria-label="Câu bạn ghép"></div>
      <div class="tiles-pool">${tiles.map((t, i) => `<button class="tile" data-i="${i}">${esc(t)}</button>`).join('')}</div>`;
    const draw = () => {
      $('#tiles-answer').innerHTML = ss.chosen.map((i, k) => `<button class="tile" data-k="${k}">${esc(tiles[i])}</button>`).join('');
      area.querySelectorAll('.tiles-pool .tile').forEach((b) => b.classList.toggle('used', ss.chosen.includes(+b.dataset.i)));
      $('#tiles-answer').querySelectorAll('.tile').forEach((b) => b.onclick = () => { ss.chosen.splice(+b.dataset.k, 1); sfx('tap'); draw(); });
      $('#tiles-answer .tile:last-child')?.classList.toggle('pop', ss.justAdded);
      fillSlots([...ss.answerOf()].filter(isHan).length);
      ss.justAdded = false;
    };
    area.querySelectorAll('.tiles-pool .tile').forEach((b) => b.onclick = () => {
      if (ss.checked) return;
      ss.chosen.push(+b.dataset.i); ss.justAdded = true; if (!sayWord(tiles[+b.dataset.i])) sfx('tap'); draw();
    });
    ss.answerOf = () => ss.chosen.map((i) => tiles[i]).join('');
  } else {
    const zh = ss.mode === 'hanzi';
    area.innerHTML = `<input class="answer ${zh ? 'zh' : ''}" id="answer" autocomplete="off" autocapitalize="off" spellcheck="false"
        aria-label="${zh ? 'Gõ chữ Hán câu bạn nghe được' : 'Gõ pinyin câu bạn nghe được'}"
        lang="${zh ? 'zh-CN' : 'en'}" placeholder="${zh ? '用中文输入法打字…' : 'Gõ pinyin, vd: wo qu chaoshi'}">
      <div class="answer-hint">${zh ? 'Cần bộ gõ tiếng Trung (pinyin IME) trên máy / điện thoại.'
        : `Gõ liền hay cách đều được; dấu thanh / số thanh (wǒ, wo3) ${S().strictTone ? '<b>bắt buộc</b>' : 'không bắt buộc'}.`}</div>`;
    const inp = $('#answer');
    if (!coarse()) inp.focus();
    ss.answerOf = () => inp.value;
    inp.addEventListener('input', () => {
      const v = inp.value;
      fillSlots(zh ? [...v].filter(isHan).length : SYL ? parseUserPinyin(v, SYL).length : v.trim().split(/\s+/).filter(Boolean).length);
    });
  }
  if (S().autoplay || ss.kind === 'speed') setTimeout(() => play(sent, rate), 250);
  ss.timerPending = ss.kind === 'speed';   // đồng hồ bắt đầu khi nghe xong câu (audioEnded)
}

// ---------------------------------------------------------------- bộ đếm tiến độ
// Tổng số câu giữ cố định (ss.base); câu sai được thêm vào cuối bài đếm riêng là "ôn lại", thanh tiến độ không lùi.
function countBadge(ss) {
  const base = ss.base || ss.items.length, extra = ss.items.length - base;
  const label = ss.i < base ? `${ss.i + 1}/${base}` : `Ôn lại ${ss.i - base + 1}/${extra}`;
  return `<span class="count" aria-label="Câu ${label}">${label}${ss.i < base && extra > 0 ? ` <small>+${extra} ôn lại</small>` : ''}</span>`;
}
function progressPct(ss, answered) {
  const base = ss.base || ss.items.length, done = ss.i + (answered ? 1 : 0);
  if (ss.i >= base) return 100;
  return Math.min(100, (100 * done) / base);
}

// ---------------------------------------------------------------- bài tập: dịch Việt → Trung (chấm từng từ, trái → phải)
const MODE_NAME = { pinyin: 'Pinyin', hanzi: 'Chữ Hán', tiles: 'Ghép từ' };
const coarse = () => matchMedia('(pointer: coarse)').matches;   // màn cảm ứng: không tự bật bàn phím

/** Chữ trên chip theo lựa chọn hiện tại (kể cả lựa chọn sẽ áp dụng từ câu sau). */
const EX_NAME = { listen: 'Nghe chép', translate: 'Dịch', read: 'Đọc' };
/** Nhãn chip đầu bài: "Nghe chép · Pinyin"; dạng Đọc không có cách nhập. */
const chipText = (ss) => (ss.kind === 'speed' ? MODE_NAME[ss.mode]
  : ss.exercise === 'read' ? EX_NAME.read : `${EX_NAME[ss.exercise] || EX_NAME.listen} · ${MODE_NAME[ss.mode]}`);
function syncChip(ss) {
  const tg = $('.opts-toggle');
  if (tg) tg.textContent = chipText(ss);
}

/** Dạng bài + cách nhập. Màn hẹp: gộp thành một chip, bấm mới mở bảng chọn; màn rộng: hiện thẳng. */
function practiceOptions(ss, modeBtn) {
  return `<button type="button" class="opts-toggle" aria-expanded="false" aria-controls="practice-opts">${chipText(ss)}</button>
      <div class="practice-opts" id="practice-opts">
        ${exerciseSwitch(ss)}
        ${modeBtn ? `<span class="modes" role="group" aria-label="Cách nhập">${modeBtn('pinyin', 'Pinyin')}${modeBtn('hanzi', 'Chữ Hán')}${modeBtn('tiles', 'Ghép từ')}</span>` : ''}
      </div>`;
}

function exerciseSwitch(ss) {
  if (ss.kind === 'speed') return '';
  const b = (k, label, off) => `<button data-ex="${k}" aria-pressed="${ss.exercise === k}"${off ? ` disabled title="${off}"` : ''}>${label}</button>`;
  const noMic = canRead() ? '' : inAppBrowser() ? 'Mở trang bằng Chrome hoặc Safari để luyện đọc' : 'Trình duyệt này chưa nhận được giọng nói — dùng Chrome, Edge hoặc Safari';
  return `<span class="modes ex-switch" role="group" aria-label="Dạng bài">${b('listen', `${icon('listen')} Nghe chép`)}${b('translate', `${icon('translate')} Dịch`)}${b('read', `${icon('mic')} Đọc`, noMic)}</span>`;
}
function bindExerciseSwitch(ss) {
  const tg = $('.opts-toggle');
  if (tg) tg.onclick = () => {
    const open = tg.getAttribute('aria-expanded') !== 'true';
    tg.setAttribute('aria-expanded', open);
    $('#practice-opts').classList.toggle('open', open);
  };
  view.querySelectorAll('[data-ex]').forEach((b) => b.onclick = () => {
    if (ss.exercise === b.dataset.ex) return;
    ss.exercise = b.dataset.ex;   // chỉ áp dụng cho bài này; mặc định đặt trong Cài đặt
    if (ss.kind === 'review') ss.exPinned = true;
    if (!ss.checked) { renderItem(); return; }
    // câu này đã chấm xong: đổi dạng bài áp dụng từ câu sau
    view.querySelectorAll('[data-ex]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    syncChip(ss);
  });
}

/** Các từ của câu kèm vị trí ký tự (để lấy pinyin từng chữ). */
function wordsOf(sent) {
  const chars = [...sent.hz], out = [];
  let k = 0;
  for (const w of sent.w) {
    while (k < chars.length && chars[k] !== [...w][0]) k++;
    const idx = [...w].map(() => k++);
    out.push({ w, idx, py: idx.map((i) => sent.py[i] || '').join('') });
  }
  return out;
}

/** So câu người học với câu mẫu TỪNG TỪ từ trái sang phải.
 *  → { done: số từ đầu câu đã đúng, why: 'wrong' | 'tone' | 'extra' | null, correct } */
async function checkWords(sent, answer, mode) {
  const words = wordsOf(sent), chars = [...sent.hz];
  let pos = 0;
  if (mode === 'pinyin') {
    const all = words.flatMap((w) => w.idx.map((k) => ({ ...sylOf(sent.py[k]), ch: chars[k] })));
    const user = parseUserPinyin(answer, await syllables(), sylHint(all));
    for (let i = 0; i < words.length; i++) {
      for (const k of words[i].idx) {
        const e = { ...sylOf(sent.py[k]), ch: chars[k], sandhi3: sandhi3At(sent, k) };
        while (user[pos]?.s === 'r' && !isErhua(e)) pos++;        // "r" cuộn lưỡi gõ thêm (wanr): bỏ qua
        const u = user[pos];
        if (isErhua(e) && (!u || !sameSyl(e.s, u.s))) continue;   // 儿 gõ thiếu: bỏ qua
        if (!u || !sameSyl(e.s, u.s)) return { done: i, why: 'wrong', correct: false };
        if (!toneAccepted(e, u.t)) return { done: i, why: 'tone', correct: false };
        pos++;
      }
    }
    while (user[pos]?.s === 'r') pos++;
    return pos < user.length ? { done: words.length, why: 'extra', correct: false } : { done: words.length, why: null, correct: true };
  }
  // câu mẫu không có 儿 mà người học gõ 玩儿 / 哪儿 (thói quen cuộn lưỡi): bỏ 儿 gõ thêm
  const user = [...answer].filter(isHan).filter((c) => c !== '儿' || chars.includes('儿'));
  for (let i = 0; i < words.length; i++) {
    const w = [...words[i].w];
    if (user.slice(pos, pos + w.length).join('') !== words[i].w) return { done: i, why: 'wrong', correct: false };
    pos += w.length;
  }
  return pos < user.length ? { done: words.length, why: 'extra', correct: false } : { done: words.length, why: null, correct: true };
}

/** Chuỗi các từ đã khoá (đúng hoặc được gợi ý), theo cách nhập hiện tại. */
function lockedText() {
  const ss = session, words = wordsOf(ss.items[ss.i]).slice(0, ss.tr.locked);
  if (ss.mode === 'pinyin') return words.length ? words.map((w) => w.py).join(' ') + ' ' : '';
  return words.map((w) => w.w).join('');
}

function drawWordSlots(reveal = false) {
  const ss = session, words = wordsOf(ss.items[ss.i]), tr = ss.tr;
  $('#word-slots').innerHTML = words.map((w, i) => {
    const show = reveal || i < tr.locked;
    const cls = i < tr.locked ? (tr.hinted.has(i) ? 'hinted' : 'ok') : reveal ? 'revealed' : i === tr.wrongAt ? 'bad' : '';
    return `<span class="wslot ${cls}" style="--n:${[...w.w].length};--i:${i}">${show
      ? `<small>${esc(w.py)}</small><b>${esc(w.w)}</b>` : '<small>&nbsp;</small><b>&nbsp;</b>'}</span>`;
  }).join('');
}

async function renderTranslate() {
  const ss = session, sent = ss.items[ss.i];
  ss.base ??= ss.items.length;
  saveResume(ss);
  const words = wordsOf(sent);
  ss.tr = { locked: 0, hinted: new Set(), tries: 0, wrongAt: -1 };
  ss.syncTiles = null;
  const modeBtn = (m, label) => `<button data-mode="${m}" aria-pressed="${ss.mode === m}">${label}</button>`;
  view.innerHTML = `
    <div class="practice-head">
      <a class="back" href="${ss.back}">← Thoát</a>
      <h1 class="title">${esc(ss.title)}</h1>${countBadge(ss)}
      ${practiceOptions(ss, modeBtn)}
    </div>
    <div class="progress"><div id="progress-bar" style="width:${progressPct(ss, false)}%"></div></div>
    ${ss.glossary?.length ? `<details class="glossary"><summary>Từ chuyên ngành của bài (${ss.glossary.length})</summary>
      <div>${ss.glossary.map((g) => `<span class="term"><b>${esc(g.hanzi)}</b> ${esc(g.pinyin.replace(/ /g, ''))} · ${esc(g.meaning_vi)}</span>`).join('')}</div></details>` : ''}
    <div class="vi-prompt">${esc(sent.vi)}</div>
    <div class="hint-line">Dịch sang tiếng Trung · ${words.length} từ</div>
    <div class="word-slots" id="word-slots"></div>
    ${ss.combo >= 2 ? `<div class="combo">${icon('streak')} ${ss.combo} câu đúng liên tiếp</div>` : ''}
    <div id="tr-feedback" class="tr-feedback" aria-live="polite"></div>
    <div id="input-area"></div>
    <div class="actions"><button class="btn primary" id="btn-check">Nộp <kbd>Enter</kbd></button>
      <button class="btn" id="btn-hint">${icon('hint')} Gợi ý từ tiếp</button>
      <button class="btn" id="btn-skip">Xem đáp án</button></div>
    <p class="keys">Phím tắt: <kbd>Enter</kbd> nộp · <kbd>Ctrl</kbd>+<kbd>/</kbd> gợi ý từ tiếp · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> xem đáp án</p>
    <div id="result" aria-live="polite"></div>`;
  stagger('.vi-prompt, .hint-line, .word-slots, #input-area, .actions', 'slide-in');
  bindExerciseSwitch(ss);
  view.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => {
    ss.mode = b.dataset.mode;
    if (!ss.checked) { renderTranslate(); return; }
    view.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    syncChip(ss);
  });
  $('#btn-check').onclick = () => check();
  $('#btn-skip').onclick = () => check(true);
  $('#btn-hint').onclick = () => {
    const tr = ss.tr;
    if (ss.checked || tr.locked >= words.length) return;
    tr.hinted.add(tr.locked);
    tr.locked++;
    tr.wrongAt = -1;
    sfx('tap');
    drawWordSlots();
    if (ss.syncTiles) ss.syncTiles();
    else { const inp = $('#answer'); inp.value = lockedText(); inp.focus(); }
    if (tr.locked >= words.length) check();   // gợi ý tới hết câu → xong câu
  };

  const area = $('#input-area');
  if (ss.mode === 'tiles') {
    const tiles = await tilesFor(sent);
    ss.chosen = [];
    area.innerHTML = `<div class="tiles-answer" id="tiles-answer" aria-label="Câu bạn ghép"></div>
      <div class="tiles-pool">${tiles.map((t, i) => `<button class="tile" data-i="${i}">${esc(t)}</button>`).join('')}</div>`;
    const draw = () => {
      $('#tiles-answer').innerHTML = ss.chosen.map((i, k) => `<button class="tile" data-k="${k}">${esc(tiles[i])}</button>`).join('');
      area.querySelectorAll('.tiles-pool .tile').forEach((b) => b.classList.toggle('used', ss.chosen.includes(+b.dataset.i)));
      $('#tiles-answer').querySelectorAll('.tile').forEach((b) => b.onclick = () => {
        if (ss.checked) return;
        ss.chosen.splice(+b.dataset.k, 1); sfx('tap'); draw();
      });
    };
    area.querySelectorAll('.tiles-pool .tile').forEach((b) => b.onclick = () => {
      if (ss.checked || ss.chosen.includes(+b.dataset.i)) return;
      ss.chosen.push(+b.dataset.i); if (!sayWord(tiles[+b.dataset.i])) sfx('tap'); draw();
    });
    ss.answerOf = () => ss.chosen.map((i) => tiles[i]).join('');
    // giữ các ô của phần đã khoá, trả phần sai về hàng chờ; phần được gợi ý mà chưa chọn thì tự chọn giúp
    ss.syncTiles = () => {
      const target = lockedText();
      const kept = [];
      let txt = '';
      for (const i of ss.chosen) {
        if (!target.startsWith(txt + tiles[i])) break;
        kept.push(i); txt += tiles[i];
      }
      while (txt.length < target.length) {
        const rest = target.slice(txt.length);
        const j = tiles.findIndex((t, i) => !kept.includes(i) && rest.startsWith(t));
        if (j < 0) break;
        kept.push(j); txt += tiles[j];
      }
      ss.chosen = kept;
      draw();
    };
  } else {
    const zh = ss.mode === 'hanzi';
    area.innerHTML = `<input class="answer ${zh ? 'zh' : ''}" id="answer" autocomplete="off" autocapitalize="off" spellcheck="false"
        aria-label="${zh ? 'Gõ chữ Hán câu tiếng Trung' : 'Gõ pinyin câu tiếng Trung'}"
        lang="${zh ? 'zh-CN' : 'en'}" placeholder="${zh ? '用中文输入法打字…' : 'Gõ pinyin của câu tiếng Trung'}">
      <div class="answer-hint">Chấm từng từ từ trái sang phải: từ đúng được khoá lại, sai thì sửa và nộp lại tới khi đúng.</div>`;
    const inp = $('#answer');
    if (!coarse()) inp.focus();
    ss.answerOf = () => inp.value;
  }
  drawWordSlots();
}

async function checkTranslate(giveUp = false) {
  const ss = session, sent = ss.items[ss.i], tr = ss.tr, words = wordsOf(sent);
  if (!giveUp) {
    const answer = ss.answerOf ? ss.answerOf() : '';
    if (!answer.trim() && tr.locked < words.length) {
      $('#tr-feedback').innerHTML = 'Gõ câu tiếng Trung của bạn, hoặc bấm “Gợi ý từ tiếp”.';
      replayAnim($('#input-area'), 'shake');
      return;
    }
    tr.tries++;
    const r = tr.locked >= words.length ? { done: words.length, correct: true }
      : await checkWords(sent, answer, ss.mode === 'tiles' ? 'hanzi' : ss.mode);
    const before = tr.locked;
    if (r.done >= tr.locked) tr.locked = r.done;
    if (!r.correct) {
      // câu gõ lại mà làm sai cả phần đã khoá: vẫn giữ khoá, báo sai ở từ đầu tiên chưa khoá
      tr.wrongAt = r.why === 'extra' ? -1 : tr.locked;
      drawWordSlots();
      if (tr.locked > before) sfx('tap');
      const at = tr.locked + 1;
      $('#tr-feedback').innerHTML = `<span class="bad">✗ ${r.why === 'extra' ? 'Đủ các từ rồi nhưng còn thừa phần cuối, xoá bớt nhé.'
        : r.done < before ? `Phần đầu câu bị sửa sai, giữ nguyên ${before} từ đã đúng.`
        : r.why === 'tone' ? `Từ thứ ${at} đúng âm nhưng <b>sai thanh</b>.` : `Từ thứ ${at} khác câu mẫu.`}</span>
        ${tr.locked ? ` Đã đúng ${tr.locked}/${words.length} từ.` : ''} <span class="muted">· lần ${tr.tries}</span>
        ${tr.tries === 1 && r.why === 'wrong' ? '<br><span class="muted">Câu mẫu là một cách dịch; nếu bạn dịch theo cách khác, câu của bạn vẫn có thể đúng — bấm “Xem đáp án” để tự so.</span>' : ''}`;
      sfx('bad');
      replayAnim($('#input-area'), 'shake');
      if (ss.syncTiles) ss.syncTiles();
      return;
    }
  }
  // xong câu: đúng hết, hoặc xem đáp án
  ss.checked = true;
  const firstTry = !giveUp && tr.tries === 1 && tr.hinted.size === 0;
  ss.results.push({ sent, outcome: firstTry ? 'first' : giveUp ? 'revealed' : 'fixed',
                    correct: firstTry, score: firstTry ? 1 : giveUp ? 0 : 0.5, extra: 0,
                    marks: [...sent.hz].map((c) => (isHan(c) ? 'ok' : 'punct')) });
  recordReview(sent, firstTry, ss.kind === 'review', ss.src || sent.src, 'translate');
  if (!firstTry && ss.kind === 'lesson' && !ss.retried.has(sent.id)) { ss.retried.add(sent.id); ss.items.push(sent); }
  ss.combo = firstTry ? (ss.combo || 0) + 1 : 0;
  drawWordSlots(true);
  $('#tr-feedback').innerHTML = '';
  const chars = [...sent.hz];
  const used = (ss.glossary || []).filter((x) => sent.w.includes(x.hanzi));
  $('#result').innerHTML = `<div class="card result">
    <div class="verdict ${giveUp ? 'reveal' : 'ok'}">${giveUp ? 'Đáp án' : firstTry ? '✓ Chính xác!'
      : `✓ Đúng rồi <small>(${tr.tries} lần nộp${tr.hinted.size ? `, ${tr.hinted.size} gợi ý` : ''})</small>`}</div>
    <div class="sentence"><span class="sr-only">${esc(sent.hz)} — ${esc(sent.py.filter(Boolean).join(' '))}</span>${chars.map((c, i) => `<span class="ch ${isHan(c) ? (giveUp ? 'rev' : 'ok') : 'punct'}" aria-hidden="true" style="--i:${i}"><span class="p">${esc(sent.py[i] || '')}</span><span class="h">${esc(c)}</span>${hvOf(sent, i)}</span>`).join('')}</div>
    <div class="meaning">${esc(sent.vi)}</div>
    ${used.length ? `<div class="terms-used">${used.map((x) => `<span class="term"><b>${esc(x.hanzi)}</b> ${esc(x.pinyin.replace(/ /g, ''))} · ${esc(x.meaning_vi)}</span>`).join('')}</div>` : ''}
    <div class="yours">Câu mẫu là một cách dịch; cách nói khác có thể vẫn đúng.</div>
  </div>`;
  const btn = $('#btn-check');
  btn.innerHTML = 'Tiếp <kbd>Enter</kbd>';
  btn.onclick = next;
  $('#btn-skip').hidden = true;
  $('#btn-hint').hidden = true;
  afterCheck();
  const inp = $('#answer');
  if (inp) { inp.readOnly = true; if (!giveUp) inp.classList.add('is-ok'); }
  btn.focus();
  play(sent, +S().rate);   // nghe câu đúng sau khi xong
  $('#progress-bar').style.width = `${progressPct(ss, true)}%`;
  if (giveUp) { sfx('tap'); return; }
  replayAnim($('.verdict'), 'pop');
  replayAnim($('#progress-bar'), 'flash');
  if (firstTry) { stamp($('.result')); sfx(ss.combo >= 3 && ss.combo % 3 === 0 ? 'streak' : 'ok'); }
  else sfx('ok');
}

// ---------------------------------------------------------------- luyện đọc: đọc to, máy nhận giọng của trình duyệt chấm
// Máy nhận giọng trả về CHỮ HÁN nên không so chữ với chữ (đọc đúng 他 máy có thể ghi 她, 两点 thành "2点"):
// đổi chữ máy nghe được ra âm tiết + thanh (data/pinyin-chars.json) rồi gióng hàng với câu mẫu.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const canRead = () => !!SR;
const inAppBrowser = () => /FBAN|FBAV|FB_IAB|Instagram|Zalo|TikTok|musical_ly|BytedanceWebview|Line\//i.test(navigator.userAgent);
const READ_PASS = 80;   // điểm tối thiểu để qua câu
let rec = null;         // phiên nhận giọng đang chạy
let PYCHARS = null;
const charReadings = async () => (PYCHARS ??= await getJSON('data/pinyin-chars.json'));

const HAN_DIGIT = '零一二三四五六七八九';
/** 15 → 十五, 205 → 二百零五 (đọc theo giá trị); dùng cho số máy ghi bằng chữ số. */
function numToHan(n) {
  if (n < 10) return HAN_DIGIT[n];
  if (n < 20) return '十' + (n % 10 ? HAN_DIGIT[n % 10] : '');
  if (n < 100) return HAN_DIGIT[Math.floor(n / 10)] + '十' + (n % 10 ? HAN_DIGIT[n % 10] : '');
  const units = [[1e4, '万'], [1e3, '千'], [100, '百']];
  for (const [u, name] of units) {
    if (n >= u) {
      const rest = n % u, head = numToHan(Math.floor(n / u)) + name;
      if (!rest) return head;
      return head + (rest < u / 10 ? '零' : '') + (rest >= 10 && rest < 20 ? '一' : '') + numToHan(rest);
    }
  }
  return String(n);
}

/** Câu máy nghe được → các cách viết bằng chữ Hán (số đọc theo giá trị / đọc từng chữ số như năm 2024). */
function transcriptVariants(text) {
  const t = text.normalize('NFKC');
  if (!/\d/.test(t)) return [t];
  return [t.replace(/\d+/g, (d) => (d.length > 5 ? [...d].map((x) => HAN_DIGIT[x]).join('') : numToHan(+d))),
          t.replace(/\d/g, (x) => HAN_DIGIT[x])];
}

/** Chữ máy nghe được → [{c, reads:[{s,t}]}] (bỏ dấu câu, chữ Latin). 二 đọc được cả liǎng: máy hay ghi 两 thành "2". */
function heardUnits(text, table) {
  return [...text].filter(isHan).map((c) => {
    const reads = (table[c] || '').split(' ').filter(Boolean).map(sylOf);
    if (c === '二') reads.push({ s: 'liang', t: 3 });
    return { c, reads };
  });
}

/** So một chữ của câu mẫu với một chữ máy nghe được → 'ok' | 'tone' | 'miss'. */
function readMatch(e, h) {
  if (h.c === e.c) return 'ok';
  const alt = e.c === '一' ? [1, 2, 4] : e.c === '不' ? [2, 4] : [e.t];
  if (h.reads.some((r) => r.s === e.s && (e.t === 5 || alt.includes(r.t)))) return 'ok';   // đồng âm: 他 / 她
  return h.reads.some((r) => r.s === e.s) ? 'tone' : 'miss';
}

/** Chấm một lần đọc. transcripts: các phương án máy đưa ra (tốt nhất trước).
 *  → { score 0–100, marks[] theo từng ký tự của câu, heard[] chữ máy nghe được ứng với từng ký tự, text } */
function scoreReading(sent, transcripts, table) {
  const chars = [...sent.hz];
  const target = chars.map((c, i) => ({ c, i, ...sylOf(sent.py[i] || '') })).filter((x) => isHan(x.c));
  const cost = { ok: 0, tone: 0.5, miss: 1 };
  let best = null;
  for (const raw of transcripts.filter(Boolean)) {
    for (const text of transcriptVariants(raw)) {
      const heard = heardUnits(text, table), n = target.length, m = heard.length;
      // gióng hàng (edit distance): đọc thiếu / thừa một chữ không làm lệch cả câu. Chữ 儿 (er hoá) bỏ qua không mất điểm.
      const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
      const skip = (k) => (target[k].s === 'r' || (target[k].c === '儿' && target[k].t === 5) ? 0 : 1);
      for (let a = 1; a <= n; a++) D[a][0] = D[a - 1][0] + skip(a - 1);
      for (let b = 1; b <= m; b++) D[0][b] = b;
      for (let a = 1; a <= n; a++) {
        for (let b = 1; b <= m; b++) {
          D[a][b] = Math.min(D[a - 1][b - 1] + cost[readMatch(target[a - 1], heard[b - 1])],
                             D[a - 1][b] + skip(a - 1), D[a][b - 1] + 1);
        }
      }
      const marks = chars.map((c) => (isHan(c) ? 'miss' : 'punct')), got = chars.map(() => null);
      let a = n, b = m;
      while (a > 0) {
        if (b > 0 && D[a][b] === D[a - 1][b - 1] + cost[readMatch(target[a - 1], heard[b - 1])]) {
          marks[target[a - 1].i] = readMatch(target[a - 1], heard[b - 1]);
          got[target[a - 1].i] = heard[b - 1];
          a--; b--;
        } else if (D[a][b] === D[a - 1][b] + skip(a - 1)) {
          if (!skip(a - 1)) marks[target[a - 1].i] = 'ok';
          a--;
        } else b--;
      }
      const ok = marks.filter((x) => x === 'ok').length, tone = marks.filter((x) => x === 'tone').length;
      const score = n ? Math.round(((ok + tone / 2) / n) * 100) : 0;
      if (!best || score > best.score) best = { score, marks, heard: got, text: raw };
    }
  }
  return best || { score: 0, marks: chars.map((c) => (isHan(c) ? 'miss' : 'punct')), heard: chars.map(() => null), text: '' };
}

/** 'neng', 2 → 'néng' (để nói "nghe thành nèng"). */
function markTone(s, t) {
  const MARK = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', v: 'ǖǘǚǜ' };
  const w = s.replace(/v/g, 'v');
  if (!t || t === 5) return w.replace(/v/g, 'ü');
  const at = /a/.test(w) ? w.indexOf('a') : /e/.test(w) ? w.indexOf('e') : w.includes('ou') ? w.indexOf('o')
    : Math.max(...[...'iouv'].map((x) => w.lastIndexOf(x)));
  return (w.slice(0, at) + MARK[w[at]][t - 1] + w.slice(at + 1)).replace(/v/g, 'ü');
}

/** Câu nhận xét cụ thể cho chữ đọc chưa đúng đầu tiên. */
function readTip(sent, r) {
  const chars = [...sent.hz];
  const bad = chars.map((c, i) => i).filter((i) => r.marks[i] === 'tone' || r.marks[i] === 'miss');
  if (!bad.length) return '';
  const i = bad[0], k = chars.slice(0, i + 1).filter(isHan).length, h = r.heard[i], e = sylOf(sent.py[i] || '');
  let tip;
  if (r.marks[i] === 'tone') {
    const rd = h.reads.find((x) => x.s === e.s);
    tip = `Chữ ${k} <b class="hz">${esc(chars[i])}</b> (${esc(sent.py[i])}) máy nghe thành <b>${esc(markTone(rd.s, rd.t))}</b> — sai thanh`;
  } else {
    tip = h ? `Chữ ${k} <b class="hz">${esc(chars[i])}</b> (${esc(sent.py[i])}) máy nghe thành <b class="hz">${esc(h.c)}</b>`
      : `Chữ ${k} <b class="hz">${esc(chars[i])}</b> (${esc(sent.py[i])}) máy chưa nghe thấy`;
  }
  return tip + (bad.length > 1 ? ` <span class="muted">· và ${bad.length - 1} chữ khác</span>` : '');
}

const READ_ERR = {
  'not-allowed': 'Trình duyệt đang chặn micro. Bấm biểu tượng ổ khoá / micro cạnh thanh địa chỉ → cho phép Micro, rồi bấm mic lại.',
  'service-not-allowed': 'Trình duyệt này không cho nhận giọng nói. Thử mở bằng Chrome hoặc Safari.',
  'no-speech': 'Chưa nghe thấy gì — nói to và gần micro hơn nhé.',
  'audio-capture': 'Không tìm thấy micro. Kiểm tra tai nghe / micro rồi thử lại.',
  network: 'Cần mạng để nhận giọng nói. Kiểm tra kết nối rồi thử lại.',
  'language-not-supported': 'Trình duyệt chưa nhận được giọng tiếng Trung. Thử Chrome hoặc Safari bản mới.',
};

async function renderRead() {
  const ss = session, sent = ss.items[ss.i];
  ss.base ??= ss.items.length;
  saveResume(ss);
  ss.rd = { tries: 0, best: 0 };
  const chars = [...sent.hz];
  const showPy = S().readPinyin !== false;
  view.innerHTML = `
    <div class="practice-head">
      <a class="back" href="${ss.back}">← Thoát</a>
      <h1 class="title">${esc(ss.title)}</h1>${countBadge(ss)}
      ${practiceOptions(ss)}
    </div>
    <div class="progress"><div id="progress-bar" style="width:${progressPct(ss, false)}%"></div></div>
    ${ss.glossary?.length ? `<details class="glossary"><summary>Từ chuyên ngành của bài (${ss.glossary.length})</summary>
      <div>${ss.glossary.map((g) => `<span class="term"><b>${esc(g.hanzi)}</b> ${esc(g.pinyin.replace(/ /g, ''))} · ${esc(g.meaning_vi)}</span>`).join('')}</div></details>` : ''}
    <div class="read-card">
      <div class="sentence read-sent${showPy ? '' : ' hide-py'}" id="read-sent" lang="zh-CN">${chars.map((c, i) => `<span class="ch ${isHan(c) ? '' : 'punct'}" style="--i:${i}"><span class="p">${esc(sent.py[i] || '')}</span><span class="h">${esc(c)}</span>${hvOf(sent, i)}</span>`).join('')}</div>
      <div class="meaning read-vi">${esc(sent.vi)}</div>
      <button type="button" class="linklike py-toggle" id="btn-py" aria-pressed="${!showPy}">${showPy ? 'Ẩn pinyin' : 'Hiện pinyin'}</button>
    </div>
    <div class="player">
      <button class="small-btn" id="btn-listen" title="Nghe mẫu (Esc)">${icon('listen')} Nghe mẫu</button>
      <button class="play mic" id="btn-mic" aria-label="Bấm rồi đọc to câu này">${icon('mic')}</button>
      <button class="small-btn" id="btn-slow" title="Nghe chậm">${icon('slow')} Chậm</button>
    </div>
    <p class="mic-label" id="mic-label">Bấm mic rồi đọc to cả câu</p>
    <div class="heard-live" id="heard-live" aria-live="polite" lang="zh-CN"></div>
    ${store.readNoteSeen ? '' : '<p class="read-note" id="read-note">Giọng đọc được gửi tới dịch vụ nhận giọng của trình duyệt (Google trên Chrome, Apple trên Safari) để chuyển thành chữ. EzChinese không lưu bản ghi nào.</p>'}
    ${ss.combo >= 2 ? `<div class="combo">${icon('streak')} ${ss.combo} câu đúng liên tiếp</div>` : ''}
    <div id="read-feedback" class="tr-feedback" aria-live="polite"></div>
    <div class="actions"><button class="btn primary" id="btn-check" hidden>Câu tiếp <kbd>Enter</kbd></button>
      <button class="btn" id="btn-skip">Bỏ qua câu này</button></div>
    <p class="keys">Phím tắt: <kbd>Enter</kbd> bật / tắt mic · <kbd>Esc</kbd> nghe mẫu · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> bỏ qua</p>
    <div id="result" aria-live="polite"></div>`;
  stagger('.read-card, .player, .mic-label, .actions', 'slide-in');
  bindExerciseSwitch(ss);
  $('#btn-listen').onclick = () => play(sent, +S().rate);
  $('#btn-slow').onclick = () => play(sent, 0.7);
  $('#btn-mic').onclick = toggleMic;
  $('#btn-skip').onclick = () => check(true);
  $('#btn-py').onclick = () => {
    const hide = $('#read-sent').classList.toggle('hide-py');
    store.settings.readPinyin = !hide; persist();
    $('#btn-py').setAttribute('aria-pressed', hide);
    $('#btn-py').textContent = hide ? 'Hiện pinyin' : 'Ẩn pinyin';
  };
  charReadings().catch(() => {});   // tải sẵn bảng âm đọc trong lúc người học nghe mẫu
}

function setMic(state) {
  const b = $('#btn-mic'), l = $('#mic-label');
  if (!b) return;
  b.classList.toggle('playing', state === 'on');
  b.setAttribute('aria-pressed', state === 'on');
  b.setAttribute('aria-label', state === 'on' ? 'Đang nghe — bấm để dừng' : 'Bấm rồi đọc to câu này');
  if (l) l.textContent = state === 'on' ? 'Đang nghe… đọc xong máy tự dừng'
    : state === 'wait' ? 'Đang chấm…' : session?.rd?.tries ? 'Bấm mic để đọc lại' : 'Bấm mic rồi đọc to cả câu';
}

function stopMic(abort = false) {
  if (!rec) return;
  const r = rec;
  rec = null;
  try { abort ? r.abort() : r.stop(); } catch { /* đã dừng */ }
}

function toggleMic() {
  const ss = session;
  if (!ss || ss.checked) return;
  if (rec) { rec.stop(); return; }   // bấm lần nữa: dừng nghe, chấm phần đã đọc
  if (!canRead()) { $('#read-feedback').innerHTML = `<span class="bad">${inAppBrowser() ? 'Trình duyệt trong ứng dụng không nhận được giọng nói — mở trang bằng Chrome hoặc Safari.' : 'Trình duyệt này chưa hỗ trợ nhận giọng nói — mở bằng Chrome, Edge hoặc Safari.'}</span>`; return; }
  if (audio) audio.pause();
  const r = new SR();
  r.lang = 'zh-CN'; r.interimResults = true; r.maxAlternatives = 5; r.continuous = false;
  let finals = null, err = null;
  r.onresult = (e) => {
    const res = Array.from(e.results);
    $('#heard-live').textContent = res.map((x) => x[0].transcript).join('');
    if (res.every((x) => x.isFinal)) {
      const head = res.slice(0, -1).map((x) => x[0].transcript).join(''), last = res[res.length - 1];
      finals = Array.from(last).map((alt) => head + alt.transcript);
    }
  };
  r.onerror = (e) => { err = e.error; };
  r.onend = () => {
    if (rec === r) rec = null;
    if (session !== ss || ss.checked) return;
    if (finals?.some((t) => [...t].some(isHan))) { setMic('wait'); checkRead(finals); return; }
    setMic('idle');
    if (err === 'aborted') return;
    $('#read-feedback').innerHTML = `<span class="bad">${READ_ERR[err] || READ_ERR['no-speech']}</span>`;
  };
  rec = r;
  $('#read-feedback').innerHTML = '';
  $('#heard-live').textContent = '';
  try { r.start(); } catch { rec = null; setMic('idle'); return; }
  setMic('on');
  if (!store.readNoteSeen) { store.readNoteSeen = true; persist(); }
}

async function checkRead(transcripts, giveUp = false) {
  const ss = session, sent = ss.items[ss.i], rd = ss.rd;
  if (ss.checked) return;
  stopMic(true);
  const chars = [...sent.hz];
  let r = null;
  $('#read-note')?.remove();   // lời báo riêng tư: đã đọc một lần là đủ
  if (!giveUp) {
    rd.tries++;
    r = scoreReading(sent, transcripts, await charReadings().catch(() => ({})));
    rd.best = Math.max(rd.best, r.score);
    const sentEl = $('#read-sent');
    sentEl.classList.add('graded');
    sentEl.querySelectorAll('.ch').forEach((el, i) => { el.className = `ch ${r.marks[i]}`; });
    $('#heard-live').innerHTML = `<span class="muted">Máy nghe được:</span> ${esc(r.text)}`;
    if (r.score < READ_PASS) {
      setMic('idle');
      $('#read-feedback').innerHTML = `<span class="bad">✗ ${r.score} điểm</span> <span class="muted">· cần ${READ_PASS} để qua · lần ${rd.tries}</span><br>${readTip(sent, r)}
        <br><span class="muted">Nghe mẫu rồi đọc lại chậm, rõ từng chữ.</span>`;
      sfx('bad');
      replayAnim($('#read-sent'), 'shake');
      return;
    }
  }
  // xong câu: đọc đạt, hoặc bỏ qua
  ss.checked = true;
  const firstTry = !giveUp && rd.tries === 1;
  const marks = giveUp ? chars.map((c) => (isHan(c) ? 'rev' : 'punct')) : r.marks;
  ss.results.push({ sent, outcome: firstTry ? 'first' : giveUp ? 'revealed' : 'fixed',
                    correct: firstTry, score: firstTry ? 1 : giveUp ? 0 : 0.5, extra: 0, marks });
  recordReview(sent, firstTry, ss.kind === 'review', ss.src || sent.src, 'read');
  if (!firstTry && ss.kind === 'lesson' && !ss.retried.has(sent.id)) { ss.retried.add(sent.id); ss.items.push(sent); }
  ss.combo = firstTry ? (ss.combo || 0) + 1 : 0;
  setMic('idle');
  $('#btn-mic').disabled = true;
  $('#btn-mic').hidden = true;   // xong câu: chỉ còn "Nghe mẫu" để nghe lại
  $('#mic-label').textContent = '';
  $('#read-sent').classList.add('graded');
  $('#read-feedback').innerHTML = '';
  $('#result').innerHTML = `<div class="card result">
    <div class="verdict ${giveUp ? 'reveal' : 'ok'}">${giveUp ? 'Bỏ qua câu này'
      : firstTry ? `✓ Đọc tốt! <small>${r.score} điểm</small>` : `✓ Đạt rồi <small>${r.score} điểm · ${rd.tries} lần đọc</small>`}</div>
    ${!giveUp && r.score < 100 ? `<div class="yours">${readTip(sent, r)}</div>` : ''}
    ${!giveUp && r.score < 100 ? '<div class="legend"><span><i style="background:var(--green-soft)"></i>đúng</span><span><i style="background:var(--amber-soft)"></i>sai thanh</span><span><i style="background:var(--red-soft)"></i>sai / thiếu</span></div>' : ''}
    <div class="yours muted">Chấm theo những gì máy nghe được — thanh điệu chỉ được chấm gián tiếp.</div>
  </div>`;
  const btn = $('#btn-check');
  btn.hidden = false;
  btn.onclick = next;
  $('#btn-skip').hidden = true;
  btn.focus();
  afterCheck();
  const k = $('.keys');
  if (k) k.innerHTML = 'Phím tắt: <kbd>Enter</kbd> câu tiếp · <kbd>Esc</kbd> nghe mẫu';
  $('#progress-bar').style.width = `${progressPct(ss, true)}%`;
  if (giveUp) { sfx('tap'); return; }
  replayAnim($('.verdict'), 'pop');
  replayAnim($('#progress-bar'), 'flash');
  if (firstTry) { stamp($('.result')); sfx(ss.combo >= 3 && ss.combo % 3 === 0 ? 'streak' : 'ok'); }
  else sfx('ok');
}

function startTimer(sec) {
  const t0 = performance.now();
  const tick = () => {
    const left = 1 - (performance.now() - t0) / (sec * 1000);
    const bar = $('#timer-bar');
    if (bar) bar.style.width = Math.max(0, left * 100) + '%';
    if (left <= 0) { timerHandle = null; if (session) session.timedOut = true; check(); return; }
    timerHandle = requestAnimationFrame(tick);
  };
  timerHandle = requestAnimationFrame(tick);
}

async function check(skipped = false) {
  const ss = session;
  if (!ss || ss.checked || !ss.items[ss.i]) return;   // đã hết câu (đang ở màn kết quả)
  if (ss.exercise === 'translate') return checkTranslate(skipped);
  if (ss.exercise === 'read') return skipped ? checkRead(null, true) : toggleMic();   // Enter: bật / tắt mic
  const sent = ss.items[ss.i];
  const timedOut = ss.kind === 'speed' && ss.timedOut;
  let answer = skipped ? '' : (ss.answerOf ? ss.answerOf() : '');
  // Enter khi chưa gõ gì: nhắc, không chấm, không đưa vào mục ôn
  if (!skipped && !timedOut && !answer.trim()) {
    $('#retry').innerHTML = '<p class="retry-note">Gõ những gì bạn nghe được, hoặc bấm “Không nghe ra”.</p>';
    replayAnim($('#input-area'), 'shake');
    return;
  }
  // "Xem đáp án" sau khi đã thử: chấm chữ ĐANG có trong ô (có thể đã sửa mà chưa bấm Kiểm tra), ô trống thì lấy lần gõ trước
  if (skipped && ss.tries) answer = (ss.answerOf ? ss.answerOf() : '').trim() || ss.lastAnswer || '';
  const g = await grade(sent, answer, ss.mode === 'tiles' ? 'hanzi' : ss.mode);
  const total = [...sent.hz].filter(isHan).length, okCount = g.marks.filter((m) => m === 'ok').length;
  const hasTone = g.marks.includes('tone');
  const near = okCount * 2 >= total ? 'Gần đúng' : 'Chưa đúng';   // "gần đúng" chỉ khi đúng ≥ một nửa số chữ

  // bài thường / ôn: sai thì chưa lộ đáp án — tô màu ô chữ để biết sai ở đâu, nghe lại và sửa tới khi đúng
  if (!skipped && !g.correct && ss.kind !== 'speed') {
    ss.tries = (ss.tries || 0) + 1;
    ss.lastAnswer = answer;
    paintSlots(g.marks);
    const unit = ss.mode === 'pinyin' ? 'âm tiết' : 'chữ';
    $('#retry').innerHTML = okCount === total && g.extra > 0
      ? `<p class="retry-note"><b>Đủ ${total}/${total} chữ</b> nhưng còn thừa ${g.extra} ${unit}: <b>${esc(g.extras.join(' '))}</b>. Xoá phần thừa rồi bấm Kiểm tra.</p>`
      : `<p class="retry-note"><b>${near}: ${okCount}/${total} chữ.</b>
      Ô đỏ là chữ sai hoặc còn thiếu${hasTone ? ', ô vàng là sai thanh' : ''}${g.extra > 0 ? `, bạn gõ thừa ${g.extra} ${unit} (${esc(g.extras.join(' '))})` : ''}.
      Nghe lại rồi sửa câu và bấm Kiểm tra.</p>`;
    $('#btn-skip').textContent = 'Xem đáp án';
    sfx('bad');
    replayAnim($('#input-area'), 'shake');
    setTimeout(() => { if (session === ss && !ss.checked) play(sent, +S().rate); }, 500);
    const inp = $('#answer');
    if (inp) inp.focus();
    return;
  }

  stopTimer();
  ss.checked = true;
  const tries = (ss.tries || 0) + (skipped ? 0 : 1);
  const firstTry = g.correct && tries === 1;
  const outcome = firstTry ? 'first' : g.correct ? 'fixed' : timedOut ? 'timeout' : 'revealed';
  ss.results.push({ sent, ...g, outcome, correct: firstTry, score: firstTry ? 1 : g.correct ? 0.5 : g.score });
  recordReview(sent, firstTry, ss.kind === 'review', ss.src || sent.src, 'listen');
  if (!firstTry && ss.kind === 'lesson' && !ss.retried.has(sent.id)) {  // chưa đúng ngay lần đầu: gặp lại ở cuối bài một lần
    ss.retried.add(sent.id); ss.items.push(sent);
  }
  if (ss.kind === 'speed') { ss.streak = g.correct ? ss.streak + 1 : 0; ss.bestStreak = Math.max(ss.bestStreak, ss.streak); }
  ss.combo = firstTry ? (ss.combo || 0) + 1 : 0;

  const verdict = g.correct
    ? (firstTry ? '✓ Chính xác!' : `✓ Đúng rồi <small>(${tries} lần kiểm tra)</small>`)
    : timedOut ? `Hết giờ <small>· đúng ${okCount}/${total} chữ</small>`
    : skipped ? (ss.tries && answer.trim() ? `Đáp án <small>· câu bạn gõ đúng ${okCount}/${total} chữ</small>` : 'Đáp án')
    : `${near} <small>· ${okCount}/${total} chữ</small>`;
  const chars = [...sent.hz];
  $('#retry').innerHTML = '';
  const blank = !answer.trim();   // "Không nghe ra" khi chưa gõ gì: chỉ cho xem đáp án, không chấm là sai
  const shown = blank ? g.marks.map((m) => (m === 'punct' ? m : 'rev')) : g.marks;
  $('#result').innerHTML = `<div class="card result">
    <div class="verdict ${g.correct ? 'ok' : 'reveal'}">${verdict}</div>
    <div class="sentence"><span class="sr-only">${esc(sent.hz)} — ${esc(sent.py.filter(Boolean).join(' '))}</span>${chars.map((c, i) => `<span class="ch ${shown[i]}" aria-hidden="true" style="--i:${i}"><span class="p">${esc(sent.py[i] || '')}</span><span class="h">${esc(c)}</span>${hvOf(sent, i)}</span>`).join('')}</div>
    <div class="meaning">${esc(sent.vi)}</div>
    ${(() => { const used = (ss.glossary || []).filter((x) => sent.w.includes(x.hanzi));
      return used.length ? `<div class="terms-used">${used.map((x) => `<span class="term"><b>${esc(x.hanzi)}</b> ${esc(x.pinyin.replace(/ /g, ''))} · ${esc(x.meaning_vi)}</span>`).join('')}</div>` : ''; })()}
    ${answer ? `<div class="yours">Bạn gõ: <b>${esc(answer)}</b>${g.extra > 0 ? ` · thừa ${g.extra} ${ss.mode === 'pinyin' ? 'âm tiết' : 'chữ'}` : ''}</div>` : ''}
    ${altNote(g.alt)}
    ${!g.correct && answer ? `<div class="legend"><span><i style="background:var(--green-soft)"></i>đúng</span>${ss.mode === 'pinyin' ? '<span><i style="background:var(--amber-soft)"></i>sai thanh</span>' : ''}<span><i style="background:var(--red-soft)"></i>sai / thiếu</span></div>` : ''}
    ${ss.kind === 'speed' ? `<div class="yours">Chuỗi đúng: <b>${ss.streak}</b></div>` : ''}
  </div>`;
  const btn = $('#btn-check');
  btn.innerHTML = 'Tiếp <kbd>Enter</kbd>';
  btn.onclick = next;
  $('#btn-skip').hidden = true;
  btn.focus();
  afterCheck();

  // hiệu ứng
  $('#progress-bar').style.width = `${progressPct(ss, true)}%`;
  paintSlots(shown);
  const inp = $('#answer') || $('#tiles-answer');
  if (inp) { if (!skipped) inp.classList.add(g.correct ? 'is-ok' : 'is-bad'); if (inp.id === 'answer') inp.readOnly = true; }
  if (skipped) { sfx('tap'); return; }   // tự xin xem đáp án: không rung, không âm "sai"
  if (g.correct) {
    replayAnim($('.verdict'), 'pop');
    if (firstTry) stamp($('.result'));
    sfx(firstTry && ss.combo >= 3 && ss.combo % 3 === 0 ? 'streak' : 'ok');
    replayAnim($('#progress-bar'), 'flash');
  } else {
    sfx('bad');
    replayAnim($('#input-area'), 'shake');
  }
}

/** Chữ được chấp nhận nhưng khác đáp án: nhắc chữ chuẩn (他 → 她 đọc giống nhau; 這 là phồn thể của 这). */
function altNote(alt) {
  if (!alt || !alt.length) return '';
  const seen = new Set(), items = alt.filter((a) => !seen.has(a.want + a.got) && seen.add(a.want + a.got));
  return `<div class="yours alt-note">${items.map((a) => a.kind === 'sound'
    ? `Bạn gõ <b>${esc(a.got)}</b>, câu này dùng <b>${esc(a.want)}</b> — đọc giống nhau (tā) nên vẫn tính đúng.`
    : `<b>${esc(a.got)}</b> là chữ phồn thể của <b>${esc(a.want)}</b> — vẫn tính đúng; bài dùng chữ giản thể.`).join('<br>')}</div>`;
}

/** Âm Hán Việt của chữ thứ i (nếu dữ liệu có) — đặt dưới chữ Hán; tắt được trong Cài đặt. */
const hvOf = (sent, i) => (S().hanViet && sent.hv && sent.hv[i] ? `<span class="hv">${esc(sent.hv[i])}</span>` : '');

/** Câu đã chấm xong: dòng phím tắt nói đúng việc của Enter, bỏ nhắc "Chạm để nghe". */
function afterCheck() {
  const res = $('.result');
  if (res) res.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
  const k = $('.keys'), h = $('#tap-hint');
  if (k) k.innerHTML = 'Phím tắt: <kbd>Enter</kbd> câu tiếp · <kbd>Esc</kbd> nghe lại';
  if (h) h.hidden = true;
}

/** Tô màu hàng ô chữ theo kết quả chấm (đúng / sai thanh / sai) — gợi ý chỗ sai mà chưa lộ chữ. */
function paintSlots(marks) {
  const slots = [...view.querySelectorAll('.slots span')];
  const han = marks.filter((m) => m !== 'punct');
  slots.forEach((el, j) => {
    el.classList.remove('filled', 's-ok', 's-tone', 's-miss', 's-rev');
    el.classList.add(han[j] === 'ok' ? 's-ok' : han[j] === 'tone' ? 's-tone' : han[j] === 'rev' ? 's-rev' : 's-miss');
  });
}

function next() {
  const ss = session;
  ss.checked = false;
  ss.i++;
  if (ss.i < ss.items.length) renderItem(); else finish();
}

async function finish() {
  const ss = session;
  const firstTry = new Map();
  for (const r of ss.results) if (!firstTry.has(r.sent.id)) firstTry.set(r.sent.id, r);
  const rs = [...firstTry.values()];
  const right = rs.filter((r) => r.correct).length;
  const score = rs.length ? right / rs.length : 0;
  if (ss.kind === 'lesson' || ss.kind === 'speed') {   // ôn tập và câu lẻ (câu hôm nay / câu trong video) không tính vào tiến độ bài
    const p = store.progress[ss.key] || { best: 0, runs: 0 };
    store.progress[ss.key] = { best: Math.max(p.best, score), runs: p.runs + 1, at: Date.now() };
    persist();
  }
  const wrong = rs.filter((r) => !r.correct);
  const n = (o) => rs.filter((r) => r.outcome === o).length;
  const fixed = n('fixed'), revealed = n('revealed'), timeout = n('timeout');
  const TAG = { fixed: 'đã sửa đúng', revealed: 'đã xem đáp án', timeout: 'hết giờ' };
  clearResume();
  const nextLesson = ss.kind === 'lesson' ? await nextAfter(ss.key)
    : ss.kind === 'single' ? { key: ss.lessonKey, title: `cả bài ${ss.lessonTitle}` } : null;
  if (ss.kind === 'single' && ss.today) { store.todayDone = new Date().toLocaleDateString('sv'); }
  // dấu son của ngày: đếm số bài đã xong hôm nay (giờ máy người học)
  const d = new Date(), today = { key: d.toLocaleDateString('sv'), label: `${d.getDate()}/${d.getMonth() + 1}` };
  store.days = store.days || {};
  const todayCount = store.days[today.key] = (store.days[today.key] || 0) + 1;
  persist();
  view.innerHTML = `
    <h1>${score >= 0.9 ? 'Xuất sắc!' : 'Xong bài!'}</h1>
    <div class="card finish-card">
      <div class="day-seal" role="img" aria-label="Dấu son ngày ${today.label}: hôm nay đã xong ${todayCount} bài">
        <span class="seal-face"><span>每</span><span>天</span><span>一</span><span>句</span></span>
        <span class="seal-date">${today.label}${todayCount > 1 ? ` · bài ${todayCount}` : ''}</span>
      </div>
      <div class="stat-row">
        <div class="stat hero"><b>${right + fixed}/${rs.length}</b><span>câu đã làm đúng</span></div>
        <div class="stat"><b id="stat-score">0%</b><span>đúng ngay lần đầu</span></div>
        ${ss.kind === 'speed' ? `<div class="stat"><b>${ss.bestStreak}</b><span>chuỗi đúng dài nhất</span></div>` : ''}
      </div>
      ${wrong.length ? `<p class="outcomes">Đúng ngay <b>${right}</b> · sửa đúng <b>${fixed}</b> · xem đáp án <b>${revealed}</b>${timeout ? ` · hết giờ <b>${timeout}</b>` : ''}</p>` : ''}
      ${backupNudge()}
      ${wrong.length ? `<h2 class="sub">Sẽ nhắc lại sau 10 phút <span class="lead">(trong mục Ôn câu sai)</span></h2>
        <div class="wrong-list">${wrong.map((r) => `<div><span class="hz">${esc(r.sent.hz)}</span><span class="tag ${r.outcome}">${TAG[r.outcome] || ''}</span><small>${esc(r.sent.vi)}</small></div>`).join('')}</div>` : ''}
      <div class="actions">
        ${nextLesson ? `<a class="btn primary" href="#/${nextLesson.key}" style="text-decoration:none">Bài tiếp: ${nextLesson.point && nextLesson.point.length <= 6 && !isPattern(nextLesson.point) ? `<span class="pt">${esc(nextLesson.point)}</span>` : esc(nextLesson.title)} →</a>
          <a class="btn" href="#/again" style="text-decoration:none">Làm lại</a>`
        : `<a class="btn primary" href="#/again" style="text-decoration:none">Làm lại</a>`}
        <a class="btn" href="${ss.back}" style="text-decoration:none">Về danh sách</a>
      </div>
    </div>
    <div id="support"></div>`;
  stagger('h1, .card, .wrong-list > div');
  countUp($('#stat-score'), Math.round(score * 100), '%');
  const h1 = view.querySelector('h1');   // bàn phím / trình đọc màn hình: bắt đầu từ kết quả
  if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
  const bn = $('#btn-backup-nudge');
  if (bn) bn.onclick = () => { location.hash = '#/backup'; };
  sfx('finish');   // xong bài là đáng mừng, dù tỉ lệ đúng lần đầu thế nào
  renderSupport($('#support'));
}

/** Nhắc sao lưu: đã học ≥ 3 bài và 7 ngày chưa sao lưu (bộ nhớ trình duyệt trong app có thể bị xoá). */
function backupNudge() {
  const n = Object.keys(store.progress).length;
  if (n < 3 || Date.now() - (store.backupAt || 0) < 7 * 864e5) return '';
  return `<p class="backup-nudge">Tiến độ (${n} bài) chỉ lưu trên trình duyệt này. <button type="button" class="linklike" id="btn-backup-nudge">Sao lưu ngay</button> để không mất khi đổi máy.</p>`;
}

/** Bài kế tiếp chưa làm, cùng cấp (HSK) hoặc cùng mảng (giao tiếp / công sở), theo thứ tự danh sách. */
async function nextAfter(key) {
  const [grp, id] = key.split('/');
  let list = [];
  if (/^hsk\d+$/.test(grp)) {
    const lv = (await loadIndex()).levels.find((l) => `hsk${l.level}` === grp);
    list = lv ? [...lv.grammar, ...lv.topic] : [];
  } else {
    const t = (await loadTracks()).find((x) => x.id === grp);
    list = t ? t.lessons : [];
  }
  const i = list.findIndex((x) => x.id === id);
  const n = list.slice(i + 1).concat(list.slice(0, Math.max(i, 0))).find((x) => !store.progress[`${grp}/${x.id}`]);
  return n ? { ...n, key: `${grp}/${n.id}` } : null;
}

// ---------------------------------------------------------------- link tiếp thị liên kết (chỉ ở màn kết quả, người học tự bấm)
// affiliate.json:
//   offers: link ưu đãi Shopee (nạp bằng `python ez.py web shopee <file.csv>`), mỗi lần chọn ngẫu nhiên 1 link còn hạn
//   items:  sản phẩm gợi ý cụ thể (tên, ghi chú, link), bật bằng "enabled": true
// Không chặn hay chen trước bài học: người học vào bài ngay, link chỉ nằm cuối màn kết quả.

/** Link còn trong thời gian ưu đãi (giờ VN). url là chuỗi hoặc {url, start, end}. */
function activeOffers(urls) {
  const now = Date.now(), day = (d, t) => Date.parse(`${d}T${t}+07:00`);
  return [].concat(urls || []).map((x) => (typeof x === 'string' ? { url: x } : x || {}))
    .filter((x) => x.url && (!x.start || now >= day(x.start, '00:00:00')) && (!x.end || now <= day(x.end, '23:59:59')));
}

/** Khối "Ủng hộ EzChinese" cuối màn kết quả — một lá thư trên giấy kẻ dòng, ba cách ủng hộ cùng một nhịp:
 *  1. Theo dõi fanpage (miễn phí, nhiều người làm nhất → đứng đầu)  2. Mua qua link Shopee (tiếp thị liên kết, có công bố)
 *  3. Mời cà phê: QR thu nhỏ, chạm để mở rộng TẠI CHỖ (quét từ máy khác); trên điện thoại dùng nút sao chép số tài khoản. */
async function renderSupport(el) {
  if (!el) return;
  let cfg = {};
  try { cfg = await getJSON('data/affiliate.json'); } catch { /* không có link tiếp thị */ }
  if (!siteMeta?.donate) await loadSiteBg();   // site.json chưa tải xong lúc vào bài
  const items = cfg.enabled ? cfg.items || [] : [];
  const offers = cfg.offers?.enabled ? activeOffers(cfg.offers.url) : [];
  const offer = offers[Math.floor(Math.random() * offers.length)];
  const o = cfg.offers || {}, d = siteMeta?.donate?.enabled ? siteMeta.donate : null, fb = siteMeta?.facebook;
  if (!items.length && !offer && !d && !fb) return;
  const acct = d ? String(d.account).replace(/\s/g, '') : '';
  const ICON_BAG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>';
  const row = (cls, icon, title, note, cta, extra = '') => `<li class="sl-row ${cls}">
      <span class="sl-icon">${icon}</span>
      <span class="sl-text"><b>${title}</b><span class="note">${note}</span>${extra}</span>
      ${cta}</li>`;
  el.innerHTML = `<section class="support" aria-labelledby="support-title">
    <h2 class="sub" id="support-title">Ủng hộ EzChinese</h2>
    <p class="support-lead">EzChinese miễn phí, không quảng cáo, không bắt đăng ký. Thấy có ích thì giúp mình duy trì nhé:</p>
    <ul class="support-list">
      ${fb ? row('fb', ICON_FB_BADGE, 'Theo dõi fanpage EzChinese', 'Mỗi ngày một câu tiếng Trung ngay trên bảng tin — cách ủng hộ không tốn đồng nào.',
        `<a class="sl-cta" href="${esc(fb)}" target="_blank" rel="noopener">Theo dõi</a>`) : ''}
      ${offer ? row('shop', ICON_BAG, 'Mua sắm qua link Shopee', esc(o.text || 'Giá vẫn vậy, bạn không mất thêm đồng nào.'),
        `<a class="sl-cta" href="${esc(offer.url)}" target="_blank" rel="sponsored noopener">Xem ưu đãi</a>`,
        `<span class="disclosure">${esc(o.disclosure || cfg.disclosure || 'Link tiếp thị liên kết: nếu bạn mua qua link, EzChinese nhận một khoản hoa hồng nhỏ.')}</span>`) : ''}
      ${d ? `<li class="sl-row coffee">
        <button type="button" class="sl-icon qr-thumb" id="qr-toggle" aria-expanded="false" aria-controls="qr-big" title="Phóng to mã QR">
          <img src="${esc(d.qr_thumb || 'brand/donate-qr-thumb.png')}" alt="" width="56" height="56"></button>
        <span class="sl-text"><b>${esc(d.title || 'Mời mình một tách cà phê')}</b>
          <span class="note acct">${esc(d.bank)} · <b>${esc(acct.replace(/(\d{4})(?=\d)/g, '$1 '))}</b> · ${esc(d.name)}</span></span>
        <button type="button" class="sl-cta ghost" id="btn-copy-acct">Sao chép STK</button>
        <div class="qr-big" id="qr-big" hidden>
          <img src="${esc(d.qr)}" alt="Mã VietQR chuyển khoản ${esc(d.bank)} – ${esc(d.name)}" width="240" height="388" loading="lazy">
          <p>${esc(d.text || 'Quét bằng app ngân hàng.')} Đang xem trên điện thoại? Bấm <b>Sao chép STK</b> rồi dán vào app ngân hàng,
            hoặc <a href="${esc(d.qr)}" download="EzChinese-moi-ca-phe.png">lưu ảnh QR</a> để quét từ thư viện ảnh.</p>
        </div>
      </li>` : ''}
    </ul>
    ${items.length ? `<div class="support-items"><h3>${esc(cfg.title || 'Dụng cụ học gợi ý')}</h3>${items.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="sponsored noopener">
      <span><b>${esc(x.name)}</b><br><span class="note">${esc(x.note || '')}</span></span><span aria-hidden="true">›</span></a>`).join('')}</div>` : ''}
  </section>`;
  const cp = $('#btn-copy-acct');
  if (cp) cp.onclick = async () => {
    try { await navigator.clipboard.writeText(acct); cp.textContent = 'Đã chép ✓'; cp.classList.add('done'); }
    catch { cp.textContent = acct; }   // trình duyệt chặn sao chép: hiện số để tự chép
  };
  const qt = $('#qr-toggle');
  if (qt) qt.onclick = () => {
    const open = qt.getAttribute('aria-expanded') !== 'true';
    qt.setAttribute('aria-expanded', open);
    $('#qr-big').hidden = !open;
    if (open) replayAnim($('#qr-big'), 'pop');
  };
}

// ---------------------------------------------------------------- video nền YouTube (mờ, nằm sau nội dung)
// Người học dán link trong Cài đặt; chủ trang đặt video mặc định ở data/site.json → bg_video.
/** Link YouTube (watch, youtu.be, shorts, live, embed, playlist, có/không ?t=) → {id, list, start} | null */
function parseYouTube(s) {
  s = (s || '').trim();
  if (!s) return null;
  if (/^[\w-]{11}$/.test(s)) return { id: s, list: null, start: 0 };
  let u;
  try { u = new URL(/^https?:\/\//.test(s) ? s : 'https://' + s); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com')
    id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/) || [])[1] || null;
  else return null;
  if (id && !/^[\w-]{11}$/.test(id)) id = null;
  const list = u.searchParams.get('list');
  if (!id && !list) return null;
  const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
  const hms = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/) || [];
  const start = (+hms[1] || 0) * 3600 + (+hms[2] || 0) * 60 + (+hms[3] || 0);
  return { id, list, start };
}

let siteBg = '', ytPlayer = null, ytKey = '', ytReady = null, ducked = false, ytError = '';
let siteMeta = {};
async function loadSiteBg() { try { siteMeta = await getJSON('data/site.json'); siteBg = siteMeta.bg_video || ''; } catch { /* không có file: bỏ qua */ } }
function ytApi() {
  if (!ytReady) ytReady = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytReady = null; reject(new Error('YouTube')); };
    document.head.appendChild(s);
  });
  return ytReady;
}

async function applyBg() {
  const box = $('#bg-video');
  const yt = S().bgOff ? null : parseYouTube(S().bgVideo || siteBg);
  box.style.setProperty('--bg-blur', `${S().bgBlur}px`);
  box.style.setProperty('--bg-opacity', S().bgOpacity);
  const key = yt ? JSON.stringify(yt) : '';
  if (key === ytKey) { bgVolume(); return; }
  ytKey = key;
  ytError = '';
  if (ytPlayer) { try { ytPlayer.destroy(); } catch {} ytPlayer = null; }
  box.classList.remove('on');
  document.body.classList.remove('has-bg');
  box.innerHTML = '';
  if (!yt) return;
  let YT;
  try { YT = await ytApi(); } catch { return; }   // mạng chặn YouTube: trang vẫn dùng bình thường
  if (key !== ytKey) return;                      // người dùng đã đổi link trong lúc chờ
  box.innerHTML = '<div id="bg-player"></div>';
  const vars = { autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, playsinline: 1, rel: 0,
                 loop: 1, start: yt.start };
  if (yt.list) Object.assign(vars, { listType: 'playlist', list: yt.list });
  else vars.playlist = yt.id;                     // playlist = chính video đó → lặp lại liên tục
  ytPlayer = new YT.Player('bg-player', {
    host: 'https://www.youtube-nocookie.com', videoId: yt.id || undefined, playerVars: vars,
    events: {
      onReady: (e) => { e.target.mute(); e.target.playVideo(); bgVolume(); },
      onStateChange: (e) => { if (e.data === 1) { box.classList.add('on'); document.body.classList.add('has-bg'); } },   // chỉ hiện khi đã chạy (tránh khung đen)
      onError: (e) => { ytError = [101, 150, 153].includes(e.data) ? 'Chủ video không cho phát trên trang khác — chọn video khác.'
        : 'Video không tồn tại hoặc đã bị gỡ — chọn video khác.'; box.classList.remove('on'); document.body.classList.remove('has-bg'); },
    },
  });
}
/** Tiếng video nền: tắt mặc định; bật thì nhỏ lại khi câu tiếng Trung đang phát. */
function bgVolume() {
  if (!ytPlayer?.setVolume) return;
  if (S().bgSound) { ytPlayer.unMute(); ytPlayer.setVolume(ducked ? 5 : 30); } else ytPlayer.mute();
}
function duckBg(on) { ducked = on; bgVolume(); }
// trình duyệt chỉ cho bật tiếng sau khi người dùng chạm vào trang
document.addEventListener('pointerdown', () => bgVolume(), { once: true });

// ---------------------------------------------------------------- cài đặt
const dlg = $('#dlg-settings');
function fillSettings() {
  const f = dlg.querySelector('form');
  for (const [k, v] of Object.entries(S())) {
    const el = f.elements[k];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
  }
  bgHint();
}
$('#btn-settings').onclick = () => openSettings();
function openSettings() {
  fillSettings();
  dlg.querySelectorAll('details.more').forEach((d) => { d.open = false; });   // mỗi lần mở: chỉ hiện phần Luyện tập
  dlg.showModal();
}
// đóng không lưu: nút ✕, chạm ra ngoài hộp (Esc trình duyệt tự xử lý)
$('#btn-settings-close').onclick = () => dlg.close();
if (!('closedBy' in HTMLDialogElement.prototype)) dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
dlg.querySelector('[name="bgVideo"]').addEventListener('input', bgHint);
function bgHint() {
  const v = dlg.querySelector('[name="bgVideo"]').value.trim(), yt = parseYouTube(v);
  $('#bg-hint').textContent = !v ? (siteBg ? 'Để trống = dùng video nền mặc định của trang.' : 'Để trống = không có video nền.')
    : !yt ? '✗ Không phải link YouTube hợp lệ.'
    : ytError && ytKey === JSON.stringify(yt) ? `✗ ${ytError}`
    : `✓ Nhận được ${yt.list && !yt.id ? 'danh sách phát' : 'video'} — bấm Lưu để áp dụng.`;
}
/** Cài đặt đổi là lưu ngay (không có nút Lưu). Ô link video lưu khi rời ô / đóng hộp, tránh tải lại video theo từng phím. */
function saveSettings() {
  const f = dlg.querySelector('form'), before = { ...S() };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    const el = f.elements[k];
    if (!el) continue;
    store.settings[k] = el.type === 'checkbox' ? el.checked : (k === 'rate' || el.type === 'range' ? +el.value : el.value.trim());
  }
  persist();
  applyBg();
  if (session && $('#input-area') && before.mode !== S().mode) { session.mode = S().mode; if (!session.checked) renderItem(); }
  const h = $('#settings-saved');
  if (h) { h.textContent = '✓ Đã lưu'; clearTimeout(saveSettings.t); saveSettings.t = setTimeout(() => { h.textContent = ''; }, 1500); }
}
dlg.querySelector('form').addEventListener('change', saveSettings);
dlg.querySelector('form').addEventListener('input', (e) => { if (e.target.type === 'range') saveSettings(); });
dlg.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });
dlg.addEventListener('close', saveSettings);

// ---------------------------------------------------------------- sao lưu: tiến độ ⇄ mã văn bản (nén deflate + base64url)
const B64 = { enc: (u8) => btoa(Array.from(u8, (b) => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
              dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)) };
const pipe = async (u8, T) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new T('deflate-raw'))).arrayBuffer());
async function backupCode() {
  const json = JSON.stringify({ v: 1, progress: store.progress, review: store.review, settings: store.settings });
  return 'EZ1.' + B64.enc(await pipe(new TextEncoder().encode(json), CompressionStream));
}
async function readBackup(code) {
  const m = code.trim().replace(/\s+/g, '').match(/^EZ1\.([\w-]+)$/);
  if (!m) throw new Error('bad');
  return JSON.parse(new TextDecoder().decode(await pipe(B64.dec(m[1]), DecompressionStream)));
}
/** Gộp, không ghi đè: mỗi bài giữ điểm cao nhất; câu cần ôn có ở hai bên thì giữ bản đang ở hộp thấp hơn (chưa thuộc). */
function mergeBackup(d) {
  for (const [k, p] of Object.entries(d.progress || {})) {
    const q = store.progress[k];
    store.progress[k] = !q ? p : { best: Math.max(q.best, p.best), runs: Math.max(q.runs, p.runs), at: Math.max(q.at, p.at) };
  }
  for (const [id, r] of Object.entries(d.review || {})) {
    const q = store.review[id];
    if (!q || r.box < q.box || (r.box === q.box && r.due < q.due)) store.review[id] = r;
  }
  if (d.settings) store.settings = { ...DEFAULT_SETTINGS, ...d.settings };
  persist(); updateDue();
}
{
  const hint = $('#backup-hint'), box = $('#backup-code');
  let restored = false;
  $('#btn-backup-copy').onclick = async () => {
    const code = await backupCode();
    box.hidden = false; box.value = code; box.select();
    store.backupAt = Date.now(); persist();
    try { await navigator.clipboard.writeText(code); hint.textContent = `✓ Đã sao chép mã (${Object.keys(store.progress).length} bài, ${Object.keys(store.review).length} câu ôn). Dán vào ghi chú / Zalo để giữ.`; }
    catch { hint.textContent = 'Mã ở ô bên dưới — bôi đen và sao chép thủ công.'; }
  };
  $('#btn-backup-restore').onclick = async () => {
    if (box.hidden || !box.value.trim() || box.value === await backupCode()) {
      box.hidden = false; box.value = ''; box.focus(); hint.textContent = 'Dán mã vào ô rồi bấm "Khôi phục từ mã…" lần nữa.'; return;
    }
    try {
      const d = await readBackup(box.value);
      mergeBackup(d); fillSettings(); restored = true;
      hint.textContent = `✓ Đã gộp ${Object.keys(d.progress || {}).length} bài và ${Object.keys(d.review || {}).length} câu ôn vào trình duyệt này.`;
      box.value = ''; box.hidden = true;
    } catch { hint.textContent = '✗ Mã không hợp lệ — kiểm tra lại đã sao chép đủ chưa (mã bắt đầu bằng EZ1.).'; }
  };
  dlg.addEventListener('close', () => {
    box.hidden = true; box.value = ''; hint.textContent = '';
    if (restored && !session) { restored = false; applyBg(); route(); }  // vẽ lại số bài đã học
  });
}

// ---------------------------------------------------------------- phím tắt
// Ô gõ pinyin chỉ chứa chữ Latin: Enter khi bộ gõ đang soạn chữ (Telex trên Mac, bộ gõ tiếng Trung, bàn phím điện thoại
// gạch chân từ đang gõ) = chốt chữ RỒI chấm luôn. Trước đây Enter này bị nuốt im lặng → người học tưởng đã kiểm tra.
// Ô chữ Hán giữ nguyên: Enter là để chọn chữ của bộ gõ.
const pinyinBox = (t) => t?.id === 'answer' && session && !session.checked && session.mode === 'pinyin';
let checkAfterIme = false;
document.addEventListener('compositionend', (e) => {
  if (!checkAfterIme) return;
  checkAfterIme = false;
  if (pinyinBox(e.target)) setTimeout(() => check(), 0);   // đợi chữ vừa chốt vào ô rồi mới chấm
});

document.addEventListener('keydown', (e) => {
  if (!session || dlg.open) return;
  if (e.isComposing) {                                       // đang soạn chữ: để bộ gõ xử lý
    if (e.key === 'Enter' && pinyinBox(e.target)) checkAfterIme = true;
    return;
  }
  const t = e.target, tag = t.tagName;
  // đang focus nút / link / mục thu gọn / ô chọn khác: để phím làm đúng việc của phần tử đó
  const other = t.id !== 'answer' && t.id !== 'btn-check' &&
    (['BUTTON', 'A', 'SUMMARY', 'SELECT', 'TEXTAREA', 'INPUT'].includes(tag) || t.getAttribute('role') === 'tab');
  const sent = session.items[session.i];
  const speed = session.kind === 'speed' ? speedRate(session.i) : +S().rate;
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {          // Ctrl+Enter: không nghe ra / xem đáp án
    e.preventDefault();
    if (!session.checked) check(true);
  } else if (e.key === 'Enter') {
    // Safari (iPhone) báo compositionend trước keydown → isComposing đã false; keyCode 229 = Enter để chọn chữ của bộ gõ
    if (other) return;
    if (e.keyCode === 229) {                                  // Safari: chữ đã chốt sẵn → ô pinyin chấm luôn, ô chữ Hán để chọn chữ
      if (pinyinBox(t)) { e.preventDefault(); setTimeout(() => check(), 0); }
      return;
    }
    e.preventDefault(); session.checked ? next() : check();
  } else if (e.key === 'Escape') {                               // Esc: nghe lại · Shift+Esc: nghe chậm
    e.preventDefault(); if (sent) play(sent, e.shiftKey && session.kind !== 'speed' ? 0.7 : speed);
  } else if (e.key === '/' && (e.ctrlKey || e.metaKey)) {       // Ctrl+/: gợi ý từ tiếp (dạng Dịch)
    const h = $('#btn-hint');
    if (h && !h.hidden) { e.preventDefault(); h.click(); }
  }
});

// ---------------------------------------------------------------- điều hướng
async function route() {
  stopTimer();
  hideBgCoach();
  if (audio) audio.pause();
  stopMic(true);   // rời màn Đọc giữa chừng: tắt micro
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const tab = new URLSearchParams(query || '').get('tab');
  try {
    if (!parts.length) { session = null; await home(); }
    else if (parts[0] === 'review') await startReview();
    else if (parts[0] === 'backup') { session = null; backupPage(); }
    else if (parts[0] === 's' && parts[1]) await startSingle(decodeURIComponent(parts[1]), new URLSearchParams(query || '').has('today'));
    else if (parts[0] === 'again' && session) { const k = session; location.replace(k.kind === 'review' ? '#/review' : `#/${k.key}`); }
    else if ((parts[0] === 'talk' || parts[0] === 'biz') && parts[1]) {
      session = null;
      await startTrackLesson(parts[0], parts[1]);
    }
    else if (parts[0] === 'talk' || parts[0] === 'biz') { session = null; await trackPage(parts[0]); }
    else if (/^hsk\d+$/.test(parts[0]) && parts[1]) {
      session = null;
      await startLesson(+parts[0].slice(3), parts[1]);
    }
    else if (/^hsk\d+$/.test(parts[0])) { session = null; await levelPage(+parts[0].slice(3), tab); }
    else location.replace('#/');
  } catch (err) {
    const gone = err.status === 404;
    view.innerHTML = `<section class="empty"><h1>${gone ? 'Không tìm thấy bài này' : 'Không tải được bài'}</h1>
      <p>${gone ? 'Link có thể đã cũ hoặc bài đã được đổi.' : 'Mạng đang chập chờn. Kiểm tra kết nối rồi thử lại.'}</p>
      <p>${gone ? '' : '<button class="btn" id="btn-retry-load" type="button">Thử lại</button> '}<a class="btn primary" href="#/">Về trang chủ</a></p></section>`;
    const retry = $('#btn-retry-load');
    if (retry) retry.onclick = route;
    if (location.protocol === 'file:') console.warn('Hãy mở trang qua máy chủ web, không mở trực tiếp file.', err);
  }
  window.scrollTo(0, 0);
  if (document.activeElement === document.body) {
    const h = view.querySelector('h1');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
}
window.addEventListener('hashchange', route);
updateDue();
loadSiteBg().then(() => { applyBg(); renderFoot(); });
syncBgButton();
const ICON_FB_BADGE = '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1877f2"/><path d="M13.3 20v-6h2l.3-2.4h-2.3v-1.5c0-.7.2-1.2 1.2-1.2h1.3V6.8c-.2 0-1-.1-1.8-.1-1.8 0-3.1 1.1-3.1 3.2v1.7H8.9V14h2v6h2.4z" fill="#fff"/></svg>';
const ICON_FB = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5H16.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21h3z"/></svg>';
/** Chân trang: sao lưu + Facebook (link trong data/site.json). Ghi nguồn Tatoeba nằm ở trang mảng giao tiếp (t.credit). */
function renderFoot() {
  const fb = siteMeta?.facebook, nav = $('#nav-fb');
  if (nav && fb) { nav.href = fb; nav.hidden = false; }   // nút Fanpage trên thanh trên cùng (mọi trang)
  $('#foot').innerHTML = '<a href="#/backup">Sao lưu &amp; khôi phục tiến độ</a>'
    + (fb ? ` · <a class="fb-link" href="${esc(fb)}" target="_blank" rel="noopener">${ICON_FB} Facebook EzChinese</a>` : '');
}
renderFoot();
route();
