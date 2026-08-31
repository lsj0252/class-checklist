// ─────────────────────────────────────────────────────────────
//  학생용 화면 – 이름 선택 로그인 + 내 현황 (읽기 전용)
// ─────────────────────────────────────────────────────────────
import {
  db, collection, doc, onSnapshot, query, where,
  $, escapeHtml, warnIfUnconfigured, toast,
  todayStr, dateLabel, shortDate, weekStart, weekLabel,
  TYPE, checkId
} from './common.js';
import { firebaseConfig } from './firebase-config.js';

const PICK_KEY = 'cc_student_id';

const state = {
  students: [],
  items: [],
  checks: new Map(),
  me: null,
  unsubChecks: null
};

warnIfUnconfigured(firebaseConfig);

/* ─────────── 학생 명단 ─────────── */
onSnapshot(query(collection(db, 'students')), (snap) => {
  state.students = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.name.localeCompare(b.name, 'ko'));
  renderPick();

  const saved = localStorage.getItem(PICK_KEY);
  if (!state.me && saved && state.students.some((s) => s.id === saved)) {
    selectStudent(saved);
  } else if (state.me) {
    state.me = state.students.find((s) => s.id === state.me.id) || null;
    if (!state.me) backToPick();
    else renderMe();
  }
}, (err) => {
  console.error(err);
  $('#pick-list').innerHTML =
    `<p class="empty">명단을 불러오지 못했습니다. (${escapeHtml(err.code || err.message)})</p>`;
});

/* ─────────── 항목 (전체 공용) ─────────── */
onSnapshot(query(collection(db, 'items')), (snap) => {
  state.items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderMe();
}, (err) => console.error(err));

/* ─────────── 화면 ─────────── */
function renderPick() {
  const box = $('#pick-list');
  if (!state.students.length) {
    box.innerHTML = '<p class="empty">아직 등록된 학생이 없습니다. 선생님께 말씀드려 주세요.</p>';
    return;
  }
  box.innerHTML = state.students.map((s) => `
    <button class="name-btn" type="button" data-id="${s.id}">
      <span class="no">${escapeHtml(s.number)}번</span>${escapeHtml(s.name)}
    </button>`).join('');
}

$('#pick-list').addEventListener('click', (e) => {
  const btn = e.target.closest('.name-btn');
  if (btn) selectStudent(btn.dataset.id);
});

$('#switch').addEventListener('click', backToPick);

function selectStudent(id) {
  const student = state.students.find((s) => s.id === id);
  if (!student) return;
  state.me = student;
  localStorage.setItem(PICK_KEY, id);

  $('#pick').hidden = true;
  $('#me').hidden = false;

  // 내 체크 기록만 구독
  state.unsubChecks?.();
  state.unsubChecks = onSnapshot(
    query(collection(db, 'checks'), where('studentId', '==', id)),
    (snap) => {
      state.checks = new Map(snap.docs.map((d) => [d.id, d.data()]));
      renderMe();
    },
    (err) => { console.error(err); toast('현황을 불러오지 못했습니다.', 'error'); }
  );

  renderMe();
}

function backToPick() {
  state.unsubChecks?.();
  state.unsubChecks = null;
  state.me = null;
  state.checks = new Map();
  localStorage.removeItem(PICK_KEY);
  $('#me').hidden = true;
  $('#pick').hidden = false;
}

const isDone = (itemId) => !!state.checks.get(checkId(itemId, state.me?.id))?.done;

function row(item, text, subText) {
  const done = isDone(item.id);
  return `
    <li class="${done ? 'done' : 'todo'}">
      <span class="mark">${done ? '✅' : '⬜'}</span>
      <span class="text">${escapeHtml(text)}${subText ? `<span class="sub-text">${escapeHtml(subText)}</span>` : ''}</span>
      <span class="status">${done ? '완료' : '아직'}</span>
    </li>`;
}

const none = (msg) => `<li class="none">${escapeHtml(msg)}</li>`;

function renderMe() {
  if (!state.me) return;
  const today = todayStr();
  const week = weekStart(today);

  $('#me-name').textContent = `${state.me.number}번 ${state.me.name}`;
  $('#me-date').textContent = dateLabel(today);

  const homework = state.items
    .filter((i) => i.type === TYPE.HOMEWORK && i.date === today);
  const notices = state.items
    .filter((i) => i.type === TYPE.NOTICE && !i.closed)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const duty = state.items
    .find((i) => i.type === TYPE.DUTY && i.week === week && i.studentId === state.me.id);

  $('#me-homework').innerHTML = homework.length
    ? homework.map((i) => row(i, i.title)).join('')
    : none('오늘 등록된 숙제가 없어요.');

  $('#me-notice').innerHTML = notices.length
    ? notices.map((i) => row(i, i.title, `배부 ${shortDate(i.date)}`)).join('')
    : none('회수할 가정통신문이 없어요.');

  $('#me-duty').innerHTML = duty
    ? row(duty, duty.roleName, weekLabel(week))
    : none('이번 주 배정된 역할이 없어요.');

  const all = [...homework, ...notices, ...(duty ? [duty] : [])];
  const todo = all.filter((i) => !isDone(i.id)).length;
  const banner = $('#me-banner');
  if (!all.length) {
    banner.className = 'me-banner';
    banner.textContent = '오늘은 확인할 항목이 없어요.';
  } else if (todo === 0) {
    banner.className = 'me-banner all-done';
    banner.textContent = '🎉 모두 완료했어요!';
  } else {
    banner.className = 'me-banner has-todo';
    banner.textContent = `아직 ${todo}개 남았어요.`;
  }
}
