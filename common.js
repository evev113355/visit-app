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

TV.routeLengthKm = function (start, stops) {
  let s = 0, cur = start;
  stops.forEach((p) => { if (p.lat != null && cur.lat != null) { s += TV.dist(cur, p); cur = p; } });
  return s;
};
