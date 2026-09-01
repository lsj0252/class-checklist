// ─────────────────────────────────────────────────────────────
//  학생용 화면 - 이름 선택 로그인 + 내 현황 (읽기 전용)
// ─────────────────────────────────────────────────────────────
import {
  db, collection, doc, onSnapshot, query, where,
  $, escapeHtml, warnIfUnconfigured, toast,
  todayStr, dateLabel, shortDate, weekStart, weekLabel,
  TYPE, checkId, CREDIT,
  levelOf, earnedPrivileges, nextPrivilege, creditScore
} from './common.js';
import { firebaseConfig } from './firebase-config.js';

const PICK_KEY = 'cc_student_id';

const state = {
  students: [],
  items: [],
  checks: new Map(),
  certs: [],
  awards: new Map(),
  adjustments: [],
  baseScore: CREDIT.DEFAULT_BASE,
  me: null,
  unsubMine: []
};

/* ─────────── 데이터 구독 ─────────── */
function subscribe() {
  // 학생 명단
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

  // 항목 (전체 공용)
  onSnapshot(query(collection(db, 'items')), (snap) => {
    state.items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMe();
  }, (err) => console.error(err));

  // 자격증 목록 · 급수별 특권 (전체 공용)
  onSnapshot(query(collection(db, 'certs')), (snap) => {
    state.certs = snap.docs
      .map((d) => ({ id: d.id, privileges: {}, ...d.data() }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    renderMe();
  }, (err) => console.error(err));

  // 신용도 기준 점수
  onSnapshot(query(collection(db, 'settings')), (snap) => {
    const credit = snap.docs.find((d) => d.id === 'credit');
    state.baseScore = Number(credit?.data().baseScore ?? CREDIT.DEFAULT_BASE);
    renderMe();
  }, (err) => console.error(err));
}

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

  // 내 기록만 구독 (체크 · 자격증 급수 · 수동 가감점)
  unsubscribeMine();
  const onError = (err) => { console.error(err); toast('현황을 불러오지 못했습니다.', 'error'); };

  state.unsubMine.push(onSnapshot(
    query(collection(db, 'checks'), where('studentId', '==', id)),
    (snap) => {
      state.checks = new Map(snap.docs.map((d) => [d.id, d.data()]));
      renderMe();
    }, onError));

  state.unsubMine.push(onSnapshot(
    query(collection(db, 'certAwards'), where('studentId', '==', id)),
    (snap) => {
      state.awards = new Map(snap.docs.map((d) => [d.id, d.data()]));
      renderMe();
    }, onError));

  state.unsubMine.push(onSnapshot(
    query(collection(db, 'creditAdjustments'), where('studentId', '==', id)),
    (snap) => {
      state.adjustments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderMe();
    }, onError));

  renderMe();
}

function unsubscribeMine() {
  state.unsubMine.forEach((fn) => fn?.());
  state.unsubMine = [];
}

function backToPick() {
  unsubscribeMine();
  state.me = null;
  state.checks = new Map();
  state.awards = new Map();
  state.adjustments = [];
  localStorage.removeItem(PICK_KEY);
  $('#me').hidden = true;
  $('#pick').hidden = false;
}

const isDone = (itemId) => !!state.checks.get(checkId(itemId, state.me?.id))?.done;

/** 선생님이 '해당없음'으로 표시한 항목 */
const isNA = (itemId) => !!state.checks.get(checkId(itemId, state.me?.id))?.na;

function row(item, text, subText) {
  // 선생님이 '해당없음'으로 표시한 통신문은 내가 낼 필요가 없는 것
  if (isNA(item.id)) {
    return `
      <li class="skip">
        <span class="mark">➖</span>
        <span class="text">${escapeHtml(text)}<span class="sub-text">나는 안 내도 되는 통신문이에요</span></span>
        <span class="status">해당없음</span>
      </li>`;
  }
  const done = isDone(item.id);
  return `
    <li class="${done ? 'done' : 'todo'}">
      <span class="mark">${done ? '✅' : '⬜'}</span>
      <span class="text">${escapeHtml(text)}${subText ? `<span class="sub-text">${escapeHtml(subText)}</span>` : ''}</span>
      <span class="status">${done ? '완료' : '아직'}</span>
    </li>`;
}

const none = (msg) => `<li class="none">${escapeHtml(msg)}</li>`;

/** 가정통신문 아래 줄: '배부 8/29 · 9/5까지' */
function noticeSub(item) {
  let text = `배부 ${shortDate(item.date)}`;
  if (item.dueDate) {
    text += ` · ${shortDate(item.dueDate)}까지`;
    if (item.dueDate < todayStr() && !isDone(item.id)) text += ' (기한 지났어요)';
  }
  return text;
}

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
    .sort((a, b) =>
      (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31') ||
      (a.date || '').localeCompare(b.date || ''));
  const duty = state.items
    .find((i) => i.type === TYPE.DUTY && i.week === week && i.studentId === state.me.id);

  $('#me-homework').innerHTML = homework.length
    ? homework.map((i) => row(i, i.title)).join('')
    : none('오늘 등록된 숙제가 없어요.');

  $('#me-notice').innerHTML = notices.length
    ? notices.map((i) => row(i, i.title, noticeSub(i))).join('')
    : none('회수할 가정통신문이 없어요.');

  $('#me-duty').innerHTML = duty
    ? row(duty, duty.roleName, weekLabel(week))
    : none('이번 주 배정된 역할이 없어요.');

  renderCerts();
  renderCredit();

  const all = [...homework, ...notices, ...(duty ? [duty] : [])];
  const todo = all.filter((i) => !isDone(i.id) && !isNA(i.id)).length;
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

/* ─────────── 내 자격증 ─────────── */
function renderCerts() {
  const box = $('#me-certs');
  if (!state.certs.length) {
    box.innerHTML = '<p class="none-box">아직 자격증이 없어요.</p>';
    return;
  }

  box.innerHTML = state.certs.map((cert) => {
    const level = levelOf(state.awards, cert.id, state.me.id);
    const earned = earnedPrivileges(cert, level);
    const next = nextPrivilege(cert, level);

    const earnedHtml = earned.length
      ? `<ul class="priv-earned">${earned.map((p) => `
          <li><span class="lv-tag lv-${p.level}">${p.level}급</span>${escapeHtml(p.text)}</li>`).join('')}</ul>`
      : '<p class="priv-none">아직 받은 특권이 없어요. 급수를 올리면 특권이 생겨요.</p>';

    // 아직 못 딴 급수의 특권 내용은 보여주지 않는다. 목표 급수만 알려준다.
    const nextHtml = next
      ? `<p class="priv-next">다음 목표는 <strong>${next.level}급</strong>이에요.</p>`
      : '<p class="priv-next top">가장 높은 1급이에요!</p>';

    return `
      <div class="cert-card">
        <div class="cert-card-head">
          <span class="cert-title">${escapeHtml(cert.name)}</span>
          <span class="lv-badge lv-${level}">${level}급</span>
        </div>
        ${earnedHtml}
        ${nextHtml}
      </div>`;
  }).join('');
}

/* ─────────── 내 신용도 점수 ─────────── */
function renderCredit() {
  const { events, plus, minus, total, base } = creditScore(state, state.me.id);
  const recent = events.slice(0, 8);

  $('#me-credit').innerHTML = `
    <div class="credit-card">
      <div class="credit-score ${total >= base ? 'up' : 'down'}">${total}<span>점</span></div>
      <div class="credit-sub">기준 ${base}점 · 획득 +${plus} · 감점 ${minus === 0 ? 0 : `−${Math.abs(minus)}`}</div>
    </div>
    ${recent.length ? `
      <ul class="event-list">
        ${recent.map((ev) => `
          <li>
            <span class="badge-muted">${ev.date ? shortDate(ev.date) : '-'}</span>
            <span class="pt ${ev.points > 0 ? 'plus' : 'minus'}">${ev.points > 0 ? '+' : '−'}${Math.abs(ev.points)}</span>
            <span class="grow">${escapeHtml(ev.reason)}</span>
          </li>`).join('')}
      </ul>` : '<p class="none-box">아직 점수에 반영된 일이 없어요.</p>'}`;
}

/* ─────────── 시작 (선언이 모두 끝난 뒤 실행) ─────────── */
warnIfUnconfigured(firebaseConfig);
subscribe();
