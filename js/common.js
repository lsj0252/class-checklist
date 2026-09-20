// ─────────────────────────────────────────────────────────────
//  공통 유틸 + Firestore 재수출
// ─────────────────────────────────────────────────────────────
export {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDocs,
  onSnapshot, query, where, orderBy, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export { db, TEACHER_PASSWORD, CLASS_NAME } from './firebase-config.js';

/* ── DOM ── */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ── 날짜 ── */
const pad = (n) => String(n).padStart(2, '0');

export function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr() {
  return toDateStr(new Date());
}

export function parseDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`);
}

export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** 해당 날짜가 속한 주의 월요일(YYYY-MM-DD). 주간 데이터의 키로 사용 */
export function weekStart(dateStr = todayStr()) {
  const d = parseDate(dateStr);
  const offset = (d.getDay() + 6) % 7; // 월=0 … 일=6
  d.setDate(d.getDate() - offset);
  return toDateStr(d);
}

/** '9/1 ~ 9/7' 형태의 주 표기 */
export function weekLabel(ws) {
  const s = parseDate(ws);
  const e = parseDate(addDays(ws, 6));
  return `${s.getMonth() + 1}/${s.getDate()} ~ ${e.getMonth() + 1}/${e.getDate()}`;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** '9월 1일 (월)' 형태 */
export function dateLabel(dateStr) {
  const d = parseDate(dateStr);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

/** '9/1' 형태 */
export function shortDate(dateStr) {
  const d = parseDate(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function monthStart(dateStr = todayStr()) {
  return `${dateStr.slice(0, 7)}-01`;
}

/* ── 도메인 상수 ── */
export const TYPE = { HOMEWORK: 'homework', NOTICE: 'notice', DUTY: 'duty' };

export const TYPE_LABEL = {
  [TYPE.HOMEWORK]: '숙제',
  [TYPE.NOTICE]: '가정통신문',
  [TYPE.DUTY]: '1인 1역'
};

/* ── 체크 상태 ── */
/**
 * 체크는 세 가지 상태를 가진다.
 * 숙제·가정통신문은 '해당없음'을 쓴다. 결석했거나 특정 학생에게만 나가는 통신문이 있어서,
 * 안 한 것(todo)과 할 필요가 없는 것(na)을 구분해야 통계와 점수가 정확해진다.
 * 1인 1역은 항상 배정된 학생 한 명의 일이라 두 단계만 쓴다.
 */
export const CHECK = { DONE: 'done', TODO: 'todo', NA: 'na' };

/** 체크 문서에서 상태를 읽는다. na 필드가 없던 옛 문서도 그대로 동작한다 */
export const checkStateOf = (check) =>
  check?.na ? CHECK.NA : check?.done ? CHECK.DONE : CHECK.TODO;

/** 칸을 눌렀을 때 다음 상태. 숙제·가정통신문은 해당없음까지 세 단계로 돈다 */
export function nextCheckState(item, current) {
  if (item.type === TYPE.DUTY) {
    return current === CHECK.DONE ? CHECK.TODO : CHECK.DONE;
  }
  if (current === CHECK.TODO) return CHECK.DONE;
  if (current === CHECK.DONE) return CHECK.NA;
  return CHECK.TODO;
}

/** checks 문서 ID - 항목 × 학생 조합당 하나 (중복 생성 방지) */
export function checkId(itemId, studentId) {
  return `${itemId}__${studentId}`;
}

/** certAwards 문서 ID - 자격증 × 학생 조합당 하나 */
export function awardId(certId, studentId) {
  return `${certId}__${studentId}`;
}

/** Firestore Timestamp(또는 ISO 문자열) → 'YYYY-MM-DD'. 값이 없으면 null */
export function stampDate(ts) {
  if (!ts) return null;
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : toDateStr(d);
}

/* ── 자격증 급수 ── */
/** 1급이 가장 높고 10급이 시작 급수 */
export const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const START_LEVEL = 10;
export const TOP_LEVEL = 1;

/** 자격증 기록이 없으면 시작 급수(10급) */
export const levelOf = (awards, certId, studentId) =>
  Number(awards.get(awardId(certId, studentId))?.level ?? START_LEVEL);

/** 10급부터 현재 급수까지, 실제로 내용이 적힌 특권들 */
export function earnedPrivileges(cert, level) {
  const out = [];
  for (let lv = START_LEVEL; lv >= level; lv--) {
    const text = (cert.privileges?.[lv] || '').trim();
    if (text) out.push({ level: lv, text });
  }
  return out;
}

/** 바로 다음 급수의 특권 (이미 1급이면 null) */
export function nextPrivilege(cert, level) {
  const next = level - 1;
  if (next < TOP_LEVEL) return null;
  return { level: next, text: (cert.privileges?.[next] || '').trim() };
}

/**
 * 지금 실제로 누리고 있는 특권의 급수 - 특권이 적힌 급수 중 자신의 급수와
 * 가장 가까운(가장 최근에 도달한) 급수. 예: 1급·5급에만 특권이 있고 현재 3급이면
 * 아직 1급은 못 땄지만 5급은 이미 지나왔으므로 5급 특권을 누리는 것으로 본다.
 * 그런 급수가 없으면(가장 낮은 특권도 아직 못 딴 경우) null.
 */
export function currentPrivilegeLevel(cert, level) {
  const earned = earnedPrivileges(cert, level);
  return earned.length ? earned[earned.length - 1].level : null;
}

/* ── 신용도 점수 규칙 ── */
export const CREDIT = {
  ON_TIME: 1,      // 숙제·가정통신문을 마감일까지 제출
  LATE: -2,        // 마감일이 지나서 냄 (또는 마감일이 지나도록 미제출)
  DUTY_MISS: -2,   // 그 주가 끝났는데 1인 1역 미완료
  DEFAULT_BASE: 100
};

/** 항목의 마감일 - 숙제는 따로 정하지 않으면 숙제 날짜가 마감일 */
export const dueOf = (item) =>
  item.type === TYPE.HOMEWORK ? (item.dueDate || item.date) : item.dueDate || null;

/**
 * 학생 한 명의 신용도 점수 내역.
 * ctx = { items, checks, adjustments } - 교사·학생 화면이 함께 쓴다.
 * 판정 기준은 체크한 시각(checkedAt)이다.
 */
export function creditEvents(ctx, studentId) {
  const today = todayStr();
  const events = [];

  (ctx.items || []).forEach((item) => {
    const check = ctx.checks?.get(checkId(item.id, studentId));
    const done = !!check?.done;
    const on = stampDate(check?.checkedAt);   // 체크한 날짜 (아직 없으면 null)
    const due = dueOf(item);

    // 이 학생에게 해당하지 않는 항목은 점수에 넣지 않는다
    if (check?.na) return;

    // 숙제와 가정통신문은 규칙이 같다: 기한 내 +1, 지각 -2, 기한이 지난 미제출 -2
    if (item.type === TYPE.HOMEWORK || item.type === TYPE.NOTICE) {
      const word = item.type === TYPE.HOMEWORK
        ? { kind: '숙제', ok: '기한 내 제출', late: '지각 제출', miss: '미제출' }
        : { kind: '가정통신문', ok: '기한 내 회수', late: '지각 회수', miss: '미회수' };

      if (done) {
        if (!due || !on || on <= due) {
          events.push({ date: on || item.date, points: CREDIT.ON_TIME, reason: `${word.kind} ${word.ok} · ${item.title}` });
        } else {
          events.push({ date: on, points: CREDIT.LATE, reason: `${word.kind} ${word.late} · ${item.title}` });
        }
      } else if (due && due < today) {
        events.push({ date: due, points: CREDIT.LATE, reason: `${word.kind} ${word.miss} · ${item.title}` });
      }
      return;
    }

    if (item.type === TYPE.DUTY && item.studentId === studentId) {
      const weekEnd = addDays(item.week, 6);
      if (weekEnd < today && !done) {
        events.push({ date: weekEnd, points: CREDIT.DUTY_MISS, reason: `1인 1역 미완료 · ${item.roleName}` });
      }
    }
  });

  (ctx.adjustments || [])
    .filter((a) => a.studentId === studentId)
    .forEach((a) => events.push({
      date: a.date, points: Number(a.points) || 0, reason: `수동 조정 · ${a.reason}`, manual: true
    }));

  return events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

/** 기준 점수 + 가산 − 감점 */
export function creditScore(ctx, studentId) {
  const events = creditEvents(ctx, studentId);
  const plus = events.filter((e) => e.points > 0).reduce((sum, e) => sum + e.points, 0);
  const minus = events.filter((e) => e.points < 0).reduce((sum, e) => sum + e.points, 0);
  const base = Number(ctx.baseScore ?? CREDIT.DEFAULT_BASE);
  return { events, plus, minus, base, total: base + plus + minus };
}

/* ── 표시 ── */
export function rate(done, total) {
  if (!total) return null;
  return Math.round((done / total) * 100);
}

export function rateText(done, total) {
  const r = rate(done, total);
  return r == null ? '-' : `${r}%`;
}

let toastTimer = null;
export function toast(message, kind = 'info') {
  let box = $('#toast');
  if (!box) {
    box = el('div');
    box.id = 'toast';
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.className = 'toast'; }, 2200);
}

/** Firebase 설정이 아직 비어 있으면 안내 배너를 띄운다 */
export function warnIfUnconfigured(config) {
  const missing = Object.entries(config)
    .filter(([, v]) => typeof v === 'string' && v.startsWith('PASTE_'))
    .map(([k]) => k);
  if (!missing.length) return false;
  const banner = el('div', 'setup-banner',
    `⚠️ <strong>Firebase 설정이 필요합니다.</strong> ` +
    `<code>js/firebase-config.js</code> 의 ${escapeHtml(missing.join(', '))} 값을 채워 주세요.`);
  document.body.prepend(banner);
  return true;
}
