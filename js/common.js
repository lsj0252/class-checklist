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

/** checks 문서 ID — 항목 × 학생 조합당 하나 (중복 생성 방지) */
export function checkId(itemId, studentId) {
  return `${itemId}__${studentId}`;
}

/* ── 표시 ── */
export function rate(done, total) {
  if (!total) return null;
  return Math.round((done / total) * 100);
}

export function rateText(done, total) {
  const r = rate(done, total);
  return r == null ? '–' : `${r}%`;
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
