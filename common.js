// 滞納訪問アプリ 共通定義（PC・携帯の両方で使う）
const TV = {
  APP_VERSION: '0.1.0',
  ROUTE_TYPE: 'tainou-route',
  REPORT_TYPE: 'tainou-report',
  DEFAULT_START: { label: '事務所', address: '大阪府大阪市北区西天満4-12-22' },
  DEFAULT_CLIENTS: ['出向', 'TAKUTO'],
  RESULTS: ['面談', '不在', '不在票投函', '応答なし', '転居・空室の疑い', '面談拒否', 'その他'],
  CONTACTS: ['本人', '家族', '同居人', '管理会社', '近隣', 'その他'],
  SIGNS: ['電気メーター回転', '郵便物たまり', '洗濯物あり', '表札なし', '車・自転車あり'],
  NEXT_ACTIONS: ['再訪問', '架電', '書面送付', '保証会社へ報告', '終了'],
  MODES: {
    driving: '車',
    transit: '電車・徒歩',
    bicycling: '自転車',
  },
  MAX_PHOTOS: 3,
  KEEP_DAYS: 7,
  // Excel の列（見出し名 → 内部キー）
  COLUMNS: [
    { key: 'client', label: '依頼元', required: true, width: 14 },
    { key: 'caseNo', label: '案件番号', required: false, width: 12 },
    { key: 'name', label: '対象者名', required: true, width: 16 },
    { key: 'kana', label: 'フリガナ', required: false, width: 18 },
    { key: 'building', label: '物件名', required: true, width: 24 },
    { key: 'room', label: '号室', required: true, width: 8 },
    { key: 'address', label: '住所', required: true, width: 40 },
    { key: 'arrears', label: '滞納額', required: false, width: 12 },
    { key: 'phone', label: '電話番号', required: false, width: 16 },
    { key: 'note', label: '備考', required: false, width: 30 },
  ],
};

TV.norm = function (s) {
  return String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, ' ').trim();
};

// 同一人物を見分けるキー：案件番号があれば 依頼元#案件番号、なければ 依頼元|氏名|物件|号室
TV.targetId = function (t) {
  const k = (s) => TV.norm(s).replace(/\s/g, '');
  if (k(t.caseNo)) return k(t.client) + '#' + k(t.caseNo);
  return [k(t.client), k(t.name), k(t.building), k(t.room)].join('|');
};

TV.uuid = function () {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

TV.pad = (n) => String(n).padStart(2, '0');
TV.ymd = function (d, sep) {
  d = d ? new Date(d) : new Date();
  sep = sep == null ? '' : sep;
  return d.getFullYear() + sep + TV.pad(d.getMonth() + 1) + sep + TV.pad(d.getDate());
};
TV.hm = function (d) {
  d = new Date(d);
  return TV.pad(d.getHours()) + ':' + TV.pad(d.getMinutes());
};
TV.dateTimeText = function (d) {
  if (!d) return '';
  return TV.ymd(d, '/') + ' ' + TV.hm(d);
};
TV.yen = function (v) {
  if (v === '' || v == null || isNaN(Number(v))) return '';
  return Number(v).toLocaleString('ja-JP') + '円';
};
TV.safeFileName = function (s) {
  return TV.norm(s).replace(/[\\/:*?"<>|]/g, '＿').replace(/\s/g, '');
};
TV.esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
};

// 国土地理院の住所検索（無料・キー不要）
TV.geocode = async function (address) {
  const url = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(TV.norm(address));
  const res = await fetch(url);
  if (!res.ok) throw new Error('住所検索に失敗しました（' + res.status + '）');
  const list = await res.json();
  if (!list.length) return null;
  const [lng, lat] = list[0].geometry.coordinates;
  return { lat, lng, matched: list[0].properties.title };
};

TV.navUrl = function (stop, mode) {
  const dest = stop.lat != null ? stop.lat + ',' + stop.lng : encodeURIComponent(stop.address);
  return 'https://www.google.com/maps/dir/?api=1&destination=' + dest + '&travelmode=' + (mode || 'driving');
};

// 距離（km）
TV.dist = function (a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

// 出発地から近い順（最近傍法＋2-opt で交差を減らす）。戻りは考えない片道。
TV.orderStops = function (start, stops) {
  const pts = stops.filter((s) => s.lat != null);
  const noPos = stops.filter((s) => s.lat == null);
  const order = [];
  const left = pts.slice();
  let cur = start;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((p, i) => { const d = TV.dist(cur, p); if (d < bd) { bd = d; bi = i; } });
    cur = left.splice(bi, 1)[0];
    order.push(cur);
  }
  const path = [start].concat(order);
  const len = (p) => { let s = 0; for (let i = 1; i < p.length; i++) s += TV.dist(p[i - 1], p[i]); return s; };
  let improved = true, guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 1; i < path.length - 1; i++) {
      for (let k = i + 1; k < path.length; k++) {
        const cand = path.slice(0, i).concat(path.slice(i, k + 1).reverse(), path.slice(k + 1));
        if (len(cand) + 1e-9 < len(path)) { path.splice(0, path.length, ...cand); improved = true; }
      }
    }
  }
  return path.slice(1).concat(noPos);
};

// 写真を長辺1280pxに縮小し、だいたい250KB以下のJPEG（data URL）にする
TV.shrinkPhoto = async function (file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = url; });
    let w = img.naturalWidth, h = img.naturalHeight;
    const sc = Math.min(1, 1280 / Math.max(w, h));
    w = Math.round(w * sc); h = Math.round(h * sc);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    let q = 0.75, data = cv.toDataURL('image/jpeg', q);
    while (data.length * 0.75 > 250 * 1024 && q > 0.4) { q -= 0.1; data = cv.toDataURL('image/jpeg', q); }
    return data;
  } finally { URL.revokeObjectURL(url); }
};

// ルート全体を Googleマップで開くリンク（APIキー不要）。
// 1本のリンクに入る経由地は9か所までなので、多いときは区切る。電車は経由地が使えないので1区間ずつ。
TV.googleRouteLinks = function (start, stops, mode) {
  const pt = (p) => (p.lat != null && p.lat !== '' ? (+p.lat).toFixed(6) + ',' + (+p.lng).toFixed(6) : encodeURIComponent(p.address || ''));
  const link = (from, list) => {
    const dest = list[list.length - 1], mid = list.slice(0, -1);
    return 'https://www.google.com/maps/dir/?api=1&origin=' + pt(from) + '&destination=' + pt(dest) +
      (mid.length ? '&waypoints=' + mid.map(pt).join('%7C') : '') + '&travelmode=' + (mode || 'driving');
  };
  const out = [];
  const size = mode === 'transit' ? 1 : 10; // 経由地9＋目的地1
  for (let i = 0; i < stops.length; i += size) {
    const part = stops.slice(i, i + size);
    const from = i === 0 ? start : stops[i - 1];
    out.push({ label: (i === 0 ? '出発' : (i) + '番') + '→' + (i + part.length) + '番', url: link(from, part) });
  }
  return out;
};

// 日報一覧のPDF（A4横）。行がページをまたがないように1ページずつ詰めて、見出しを毎ページに付ける。
// reps：日報の配列（visitedAt, staff, result, contact, signs, promiseDate, promiseAmount, nextAction, memo, added, target）
// stage：画面外に置いた作業用の要素。html2canvas と jsPDF が必要。
TV.listPdf = async function (reps, cond, stage) {
  const e = TV.esc;
  reps = reps.slice().sort((a, b) => String(a.visitedAt).localeCompare(String(b.visitedAt)));
  const cnt = {}; reps.forEach((r) => cnt[r.result] = (cnt[r.result] || 0) + 1);
  const summary = reps.length + '件（' + (Object.entries(cnt).map(([k, n]) => k + ' ' + n).join('／') || 'なし') + '）';
  const W = 1123, H = 794; // A4横（96dpi）
  const COLS = [['No', 3], ['訪問日時', 7.5], ['担当', 7], ['依頼元', 6.5], ['対象者', 8], ['物件・号室', 11.5], ['結果', 7], ['面談相手', 5.5], ['現地の様子', 10.5], ['支払約束', 7.5], ['次回', 8.5], ['メモ', 17.5]];
  const css = '<style>' +
    '.lp{width:' + W + 'px;height:' + H + 'px;padding:30px 34px 22px;background:#fff;color:#111;font-family:"Yu Gothic","Meiryo",sans-serif;box-sizing:border-box;display:flex;flex-direction:column}' +
    '.lp .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1f4e79;padding-bottom:6px;margin-bottom:10px}' +
    '.lp h1{font-size:19px;margin:0;letter-spacing:3px;color:#1f4e79}' +
    '.lp .cond{font-size:11px;color:#333;margin-top:3px}.lp .sum{font-size:11.5px;text-align:right}' +
    '.lp .bd{flex:1;overflow:hidden}' +
    '.lp table{border-collapse:collapse;width:100%;table-layout:fixed}' +
    '.lp th,.lp td{border:1px solid #9aa6b2;padding:4px 5px;font-size:10.5px;line-height:1.45;vertical-align:top;text-align:left;word-break:break-all;overflow-wrap:anywhere;position:static}' +
    '.lp th{background:#1f4e79;color:#fff;font-weight:bold;text-align:center;font-size:10.5px}' +
    '.lp tbody tr:nth-child(even) td{background:#f2f5f9}' +
    '.lp td.c{text-align:center}.lp td.memo{white-space:pre-wrap}.lp b{font-weight:bold}' +
    '.lp .ft{display:flex;justify-content:space-between;font-size:9.5px;color:#555;margin-top:6px}' +
    '</style>';
  const head = '<colgroup>' + COLS.map((c) => '<col style="width:' + c[1] + '%">').join('') + '</colgroup><thead><tr>' + COLS.map((c) => '<th>' + c[0] + '</th>').join('') + '</tr></thead>';
  const row = (r, i) => {
    const t = r.target || {};
    const d = r.visitedAt ? TV.ymd(r.visitedAt, '/') + '<br>' + TV.hm(r.visitedAt) : '';
    const promise = [r.promiseDate ? String(r.promiseDate).replace(/-/g, '/') : '', r.promiseAmount ? TV.yen(r.promiseAmount) : ''].filter(Boolean).map(e).join('<br>');
    return '<tr><td class="c">' + (i + 1) + '</td><td>' + d + '</td><td>' + e(r.staff) + '</td><td>' + e(t.client) + '</td><td>' + e(t.name) + (r.added || t.added ? '<br><span style="color:#8e6c00">（追加訪問）</span>' : '') + '</td>' +
      '<td>' + e(t.building) + ' ' + e(t.room) + '</td><td><b>' + e(r.result) + '</b></td><td>' + e(r.contact) + '</td><td>' + e((r.signs || []).join('、')) + '</td>' +
      '<td>' + promise + '</td><td>' + e(r.nextAction) + '</td><td class="memo">' + e(r.memo) + '</td></tr>';
  };
  const now = TV.dateTimeText(new Date());
  const newPage = (first) => {
    const p = document.createElement('div'); p.className = 'lp';
    p.innerHTML = '<div class="hd"><div><h1>訪問日報 一覧</h1><div class="cond">' + e(cond) + '</div></div><div class="sum">' + (first ? e(summary) : '（続き）') + '</div></div>' +
      '<div class="bd"><table>' + head + '<tbody></tbody></table></div><div class="ft"><span>出力 ' + now + '</span><span class="pg"></span></div>';
    stage.appendChild(p); return p;
  };
  stage.innerHTML = css;
  const pages = [];
  let page = newPage(true); pages.push(page);
  reps.forEach((r, i) => {
    let tb = page.querySelector('tbody'), bd = page.querySelector('.bd');
    tb.insertAdjacentHTML('beforeend', row(r, i));
    if (bd.scrollHeight > bd.clientHeight + 1 && tb.rows.length > 1) {
      tb.lastElementChild.remove();
      page = newPage(false); pages.push(page);
      page.querySelector('tbody').insertAdjacentHTML('beforeend', row(r, i));
    }
  });
  pages.forEach((p, i) => p.querySelector('.pg').textContent = (i + 1) + ' / ' + pages.length + ' ページ');
  const pdf = new window.jspdf.jsPDF({ orientation: 'l', unit: 'mm', format: 'a4', compress: true });
  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', width: W, height: H });
    if (i) pdf.addPage('a4', 'l');
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.8), 'JPEG', 0, 0, 297, 210);
  }
  stage.innerHTML = '';
  return pdf.output('blob');
};

TV.routeLengthKm = function (start, stops) {
  let s = 0, cur = start;
  stops.forEach((p) => { if (p.lat != null && cur.lat != null) { s += TV.dist(cur, p); cur = p; } });
  return s;
};
