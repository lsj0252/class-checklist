// ─────────────────────────────────────────────────────────────
//  교사용 대시보드
//  홈 / 학생별 체크 / 항목 관리 / 통계 / 자격증 / 신용도
// ─────────────────────────────────────────────────────────────
import {
  db, TEACHER_PASSWORD, CLASS_NAME,
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, writeBatch, serverTimestamp,
  $, $$, escapeHtml, toast, warnIfUnconfigured,
  todayStr, dateLabel, shortDate, addDays, weekStart, weekLabel, monthStart,
  TYPE, TYPE_LABEL, checkId, awardId, rate, CHECK, checkStateOf, nextCheckState,
  LEVELS, START_LEVEL, CREDIT, dueOf,
  levelOf as levelIn, creditScore
} from './common.js';
import { firebaseConfig } from './firebase-config.js';

/* ─────────── 상태 ─────────── */
const state = {
  students: [],          // {id, number, name}
  items: [],             // {id, type, title, date|week, dueDate, ...}
  roles: [],             // {id, name}
  checks: new Map(),     // checkId -> {itemId, studentId, done, checkedAt}
  certs: [],             // {id, name, privileges: {'1'..'10': string}}
  awards: new Map(),     // awardId -> {certId, studentId, level}
  adjustments: [],       // {id, studentId, points, reason, date}
  baseScore: CREDIT.DEFAULT_BASE,
  checkDate: todayStr(),
  dutyWeek: weekStart(),
  started: false,
  loaded: { students: false, items: false, checks: false }
};

/** 첫 데이터가 도착하기 전에는 뼈대(skeleton)를 보여준다 */
const isReady = () => state.loaded.students && state.loaded.items && state.loaded.checks;

const col = {
  students: collection(db, 'students'),
  items: collection(db, 'items'),
  roles: collection(db, 'roles'),
  checks: collection(db, 'checks'),
  certs: collection(db, 'certs'),
  awards: collection(db, 'certAwards'),
  adjustments: collection(db, 'creditAdjustments'),
  settings: collection(db, 'settings')
};

/* ─────────── 로그인 ─────────── */
const AUTH_KEY = 'cc_teacher_auth';

function openApp() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#class-name').textContent = CLASS_NAME;
  warnIfUnconfigured(firebaseConfig);
  if (!state.started) {
    state.started = true;
    initUI();
    subscribe();
  }
}

$('#gate-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if ($('#gate-pw').value === TEACHER_PASSWORD) {
    sessionStorage.setItem(AUTH_KEY, 'ok');
    openApp();
  } else {
    $('#gate-error').hidden = false;
    $('#gate-pw').select();
  }
});

$('#logout').addEventListener('click', () => {
  sessionStorage.removeItem(AUTH_KEY);
  location.reload();
});

/* ─────────── 데이터 구독 ─────────── */
function subscribe() {
  const onError = (label) => (err) => {
    console.error(label, err);
    toast(`${label} 불러오기 실패: ${err.code || err.message}`, 'error');
  };

  onSnapshot(query(col.students), (snap) => {
    state.students = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.name.localeCompare(b.name, 'ko'));
    state.loaded.students = true;
    renderAll();
  }, onError('학생 명단'));

  onSnapshot(query(col.items), (snap) => {
    state.items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.loaded.items = true;
    renderAll();
    sweepArchive();
  }, onError('항목'));

  onSnapshot(query(col.roles), (snap) => {
    state.roles = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    renderAll();
  }, onError('1인 1역 역할'));

  onSnapshot(query(col.checks), (snap) => {
    state.checks = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    state.loaded.checks = true;
    renderAll();
  }, onError('체크 기록'));

  onSnapshot(query(col.certs), (snap) => {
    state.certs = snap.docs
      .map((d) => ({ id: d.id, privileges: {}, ...d.data() }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    renderAll();
  }, onError('자격증'));

  onSnapshot(query(col.awards), (snap) => {
    state.awards = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    renderAll();
  }, onError('자격증 급수'));

  onSnapshot(query(col.adjustments), (snap) => {
    state.adjustments = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    renderAll();
  }, onError('수동 가감점'));

  onSnapshot(query(col.settings), (snap) => {
    const credit = snap.docs.find((d) => d.id === 'credit');
    state.baseScore = Number(credit?.data().baseScore ?? CREDIT.DEFAULT_BASE);
    if ($('#credit-base') && document.activeElement !== $('#credit-base')) {
      $('#credit-base').value = state.baseScore;
    }
    renderAll();
  }, onError('설정'));
}

/* ─────────── 조회 헬퍼 ─────────── */
const homeworkOn = (date) =>
  state.items.filter((i) => i.type === TYPE.HOMEWORK && i.date === date)
    .sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));

/** 진행 중인 통신문 - 마감이 임박한 순서로 정렬 (마감일 없으면 뒤로) */
const openNotices = () =>
  state.items.filter((i) => i.type === TYPE.NOTICE && !i.closed)
    .sort((a, b) =>
      (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31') ||
      (a.date || '').localeCompare(b.date || ''));

/** 마감일이 지났는데 아직 마감 처리하지 않은 항목 */
const isOverdue = (item) => !item.closed && !!dueOf(item) && dueOf(item) < todayStr();

/** 마감일이 지나고 하루(24시간)가 더 지나면 보관 대상 (숙제·가정통신문만 해당) */
const isPastArchiveThreshold = (item) => {
  const due = dueOf(item);
  return !!due && addDays(due, 1) < todayStr();
};

const isArchived = (item) => item.archived === true;

/** '배부 8/29 · 마감 9/5' */
const noticeMeta = (item) =>
  `배부 ${shortDate(item.date)}${item.dueDate ? ` · 마감 ${shortDate(item.dueDate)}` : ''}`;

/** '9/1 · 마감 9/3' (마감일을 따로 안 정한 숙제는 날짜만) */
const homeworkMeta = (item) =>
  `${shortDate(item.date)}${item.dueDate ? ` · 마감 ${shortDate(item.dueDate)}` : ''}`;

const dutiesOf = (week) => state.items.filter((i) => i.type === TYPE.DUTY && i.week === week);

const dutyOfStudent = (studentId, week) =>
  state.items.find((i) => i.type === TYPE.DUTY && i.week === week && i.studentId === studentId) || null;

const isDone = (itemId, studentId) => !!state.checks.get(checkId(itemId, studentId))?.done;

/** 이 학생에게는 해당하지 않는 항목 (가정통신문 전용) */
const isNA = (itemId, studentId) => !!state.checks.get(checkId(itemId, studentId))?.na;

const stateOf = (itemId, studentId) => checkStateOf(state.checks.get(checkId(itemId, studentId)));

/** 항목의 기준 날짜 (숙제·통신문은 date, 1인 1역은 주 시작일) */
const itemDate = (item) => item.date || item.week || '';

/* ─────────── 자격증 · 신용도 (계산은 common.js 공용) ─────────── */
const levelOf = (certId, studentId) => levelIn(state.awards, certId, studentId);
const scoreOf = (studentId) => creditScore(state, studentId);

/* ─────────── 체크 쓰기 ─────────── */
/** 체크 문서 한 건의 내용. state 는 'done' | 'todo' | 'na' */
const checkDoc = (item, studentId, checkState) => ({
  itemId: item.id,
  studentId,
  type: item.type,
  date: itemDate(item),
  done: checkState === CHECK.DONE,
  na: checkState === CHECK.NA,
  checkedAt: serverTimestamp()
});

async function setCheck(item, studentId, checkState) {
  await setDoc(doc(db, 'checks', checkId(item.id, studentId)), checkDoc(item, studentId, checkState));
}

async function setCheckMany(pairs, checkState) {
  const batch = writeBatch(db);
  pairs.forEach(({ item, studentId }) => {
    batch.set(doc(db, 'checks', checkId(item.id, studentId)), checkDoc(item, studentId, checkState));
  });
  await batch.commit();
}

/**
 * 마감 후 하루가 지난 숙제·가정통신문을 자동으로 보관함(archived)으로 옮긴다.
 * 교사가 직접 되살린(archived: false) 항목은 다시 자동으로 보관하지 않는다.
 */
async function sweepArchive() {
  const targets = state.items.filter((i) =>
    (i.type === TYPE.HOMEWORK || i.type === TYPE.NOTICE) &&
    i.archived === undefined && isPastArchiveThreshold(i));
  if (!targets.length) return;
  const batch = writeBatch(db);
  targets.forEach((i) => batch.update(doc(db, 'items', i.id), { archived: true }));
  await batch.commit();
}

/** 항목과 그에 딸린 체크 기록을 함께 삭제 */
async function deleteItem(itemId) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'items', itemId));
  for (const c of state.checks.values()) {
    if (c.itemId === itemId) batch.delete(doc(db, 'checks', c.id));
  }
  await batch.commit();
}

/* ─────────── 화면 초기화 ─────────── */
function initUI() {
  // 탭
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab.dataset.tab}`));
    });
  });

  // 체크 탭 날짜 이동
  $('#check-date').value = state.checkDate;
  $('#check-date').addEventListener('change', (e) => {
    state.checkDate = e.target.value || todayStr();
    renderCheck();
  });
  const move = (n) => {
    state.checkDate = addDays(state.checkDate, n);
    $('#check-date').value = state.checkDate;
    renderCheck();
  };
  $('#check-prev').addEventListener('click', () => move(-1));
  $('#check-next').addEventListener('click', () => move(1));
  $('#check-today').addEventListener('click', () => {
    state.checkDate = todayStr();
    $('#check-date').value = state.checkDate;
    renderCheck();
  });

  // 체크 표 클릭 (이벤트 위임)
  $('#check-table').addEventListener('click', onCheckTableClick);

  // 홈 미완료 목록 클릭 → 해당 학생 체크 표로
  $('#pending-list').addEventListener('click', (e) => {
    if (e.target.closest('.goto-check')) {
      $('.tab[data-tab="check"]').click();
    }
  });

  initManageUI();
  initStatsUI();
  initCertUI();
  initCreditUI();
  renderAll();
}

function renderAll() {
  if (!state.started) return;
  renderHome();
  renderCheck();
  renderManage();
  renderStats();
  renderArchive();
  renderCerts();
  renderCredit();
}

/* ═══════════ 홈 ═══════════ */
function renderHome() {
  const today = todayStr();
  const week = weekStart(today);
  $('#home-date').textContent = dateLabel(today);

  if (!isReady()) {
    ['homework', 'notice', 'duty'].forEach((kind) => {
      $(`#sum-${kind}`).innerHTML = '<span class="skeleton skeleton-rate"></span>';
      $(`#sum-${kind}-sub`).innerHTML = '<span class="skeleton" style="width:120px"></span>';
      $(`#bar-${kind}`).style.width = '0%';
    });
    $('#pending-list').innerHTML = [70, 55, 62].map((w) =>
      `<div class="pending-item" style="border-color:var(--line);background:var(--surface-2)">
         <div class="pending-summary"><span class="skeleton" style="width:${w}px"></span></div>
       </div>`).join('');
    $('#done-list').innerHTML = '';
    return;
  }

  const hw = homeworkOn(today);
  const nt = openNotices();
  const dt = dutiesOf(week);

  const tally = (items, forStudent) => {
    let done = 0, total = 0;
    items.forEach((item) => {
      const targets = forStudent ? [item.studentId] : state.students.map((s) => s.id);
      targets.filter(Boolean).forEach((sid) => {
        if (isNA(item.id, sid)) return;   // 해당없음은 분모에서 뺀다
        total++;
        if (isDone(item.id, sid)) done++;
      });
    });
    return { done, total };
  };

  const paint = (kind, { done, total }, emptyText, unitText) => {
    const r = rate(done, total);
    $(`#sum-${kind}`).textContent = r == null ? '-' : `${r}%`;
    $(`#sum-${kind}-sub`).textContent = total ? `${done} / ${total}${unitText}` : emptyText;
    $(`#bar-${kind}`).style.width = `${r ?? 0}%`;
  };

  paint('homework', tally(hw, false), '오늘 등록된 숙제 없음', `명 제출 · 항목 ${hw.length}개`);
  paint('notice', tally(nt, false), '진행 중인 통신문 없음', `명 회수 · 통신문 ${nt.length}건`);
  paint('duty', tally(dt, true), '이번 주 배정 없음', `명 완료 (${weekLabel(week)})`);

  // 학생별 미완료 항목
  const pending = [];
  const complete = [];
  state.students.forEach((s) => {
    const missing = [];
    hw.forEach((i) => { if (!isDone(i.id, s.id)) missing.push(`📘 ${i.title}`); });
    nt.forEach((i) => {
      if (isDone(i.id, s.id) || isNA(i.id, s.id)) return;
      const due = isOverdue(i) ? ' (마감 지남)' : i.dueDate ? ` (마감 ${shortDate(i.dueDate)})` : '';
      missing.push(`📄 ${i.title}${due}`);
    });
    const duty = dutyOfStudent(s.id, week);
    if (duty && !isDone(duty.id, s.id)) missing.push(`🧹 ${duty.roleName}`);
    (missing.length ? pending : complete).push({ student: s, missing });
  });

  const pendingBox = $('#pending-list');
  if (!state.students.length) {
    pendingBox.innerHTML = '<p class="empty">먼저 <strong>항목 관리</strong> 탭에서 학생 명단을 등록해 주세요.</p>';
  } else if (!pending.length) {
    pendingBox.innerHTML = '<p class="empty">🎉 오늘 체크할 항목을 모두 마쳤습니다.</p>';
  } else {
    pendingBox.innerHTML = pending.map(({ student, missing }) => `
      <details class="pending-item">
        <summary class="pending-summary">
          <span>${escapeHtml(student.number)}번 ${escapeHtml(student.name)}</span>
          <span class="count">${missing.length}건</span>
        </summary>
        <ul class="pending-body">
          ${missing.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}
          <li><button class="btn ghost small goto-check" type="button">체크하러 가기 →</button></li>
        </ul>
      </details>`).join('');
  }

  $('#done-list').innerHTML = complete.length
    ? complete.map(({ student }) =>
        `<span class="chip">${escapeHtml(student.number)}번 ${escapeHtml(student.name)}</span>`).join('')
    : '<p class="empty">아직 없습니다.</p>';
}

/* ═══════════ 학생별 체크 ═══════════ */
/** 표의 열 정의 - 학생마다 다른 항목이 걸릴 수 있어 itemFor 로 매핑 */
function buildColumns() {
  const date = state.checkDate;
  const week = weekStart(date);
  const cols = [];

  homeworkOn(date).forEach((item) => cols.push({
    key: item.id, type: TYPE.HOMEWORK, title: item.title,
    meta: isOverdue(item) ? `${homeworkMeta(item)} · 지남` : homeworkMeta(item),
    metaClass: isOverdue(item) ? 'overdue' : '',
    itemFor: () => item
  }));

  openNotices().forEach((item) => cols.push({
    key: item.id, type: TYPE.NOTICE, title: item.title,
    meta: isOverdue(item) ? `${noticeMeta(item)} · 지남` : noticeMeta(item),
    metaClass: isOverdue(item) ? 'overdue' : '',
    itemFor: () => item
  }));

  if (dutiesOf(week).length) {
    cols.push({
      key: `duty-${week}`, type: TYPE.DUTY, title: '1인 1역',
      meta: weekLabel(week), itemFor: (s) => dutyOfStudent(s.id, week)
    });
  }
  return cols;
}

function renderCheck() {
  const table = $('#check-table');

  if (!isReady()) {
    $('#check-empty').hidden = true;
    const cell = (w) => `<td><span class="skeleton" style="width:${w}px;margin:0 auto"></span></td>`;
    table.innerHTML = `
      <thead><tr><th class="col-student">학생</th><th></th><th></th><th></th></tr></thead>
      <tbody>${Array.from({ length: 6 }, () => `
        <tr><td class="col-student"><span class="skeleton" style="width:82px"></span></td>
        ${cell(28)}${cell(28)}${cell(28)}</tr>`).join('')}</tbody>`;
    return;
  }

  const cols = buildColumns();

  if (!state.students.length || !cols.length) {
    table.innerHTML = '';
    $('#check-empty').hidden = false;
    $('#check-empty').innerHTML = state.students.length
      ? '이 날짜에 체크할 항목이 없습니다. <strong>항목 관리</strong> 탭에서 숙제나 가정통신문을 등록해 주세요.'
      : '먼저 <strong>항목 관리</strong> 탭에서 학생 명단을 등록해 주세요.';
    return;
  }
  $('#check-empty').hidden = true;

  const head = cols.map((c, idx) => `
    <th class="col-head">
      <span class="type-tag ${c.type}">${TYPE_LABEL[c.type]}</span>
      <span class="title">${escapeHtml(c.title)}</span>
      <span class="meta ${c.metaClass || ''}">${escapeHtml(c.meta)}</span>
      <button class="all-btn" type="button" data-col="${idx}">모두 토글</button>
    </th>`).join('');

  const body = state.students.map((s) => {
    const cells = cols.map((c, idx) => {
      const item = c.itemFor(s);
      if (!item) return '<td class="cell na">-</td>';
      const cs = stateOf(item.id, s.id);
      const face = { [CHECK.DONE]: ['done', 'O', '회수 완료'],
                     [CHECK.TODO]: ['todo', 'X', '아직'],
                     [CHECK.NA]: ['skip', '/', '해당없음'] }[cs];
      const label = c.type === TYPE.DUTY ? item.roleName : face[2];
      return `<td class="cell ${face[0]}" data-col="${idx}" data-student="${s.id}"
               title="${escapeHtml(label)}">${face[1]}</td>`;
    }).join('');
    return `<tr><td class="col-student">${escapeHtml(s.number)}번 ${escapeHtml(s.name)}</td>${cells}</tr>`;
  }).join('');

  const foot = cols.map((c) => {
    let done = 0, total = 0;
    let skipped = 0;
    state.students.forEach((s) => {
      const item = c.itemFor(s);
      if (!item) return;
      if (isNA(item.id, s.id)) { skipped++; return; }
      total++;
      if (isDone(item.id, s.id)) done++;
    });
    return `<td>${done} / ${total}${skipped ? `<span class="meta"> 해당없음 ${skipped}</span>` : ''}</td>`;
  }).join('');

  table.innerHTML = `
    <thead><tr><th class="col-student">학생</th>${head}</tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><td class="col-student">완료 인원</td>${foot}</tr></tfoot>`;

  table._cols = cols;
}

async function onCheckTableClick(e) {
  const cols = $('#check-table')._cols || [];

  const allBtn = e.target.closest('.all-btn');
  if (allBtn) {
    const c = cols[Number(allBtn.dataset.col)];
    // 해당없음으로 표시해 둔 칸은 교사가 일부러 지정한 것이므로 건드리지 않는다
    const pairs = state.students
      .map((s) => ({ item: c.itemFor(s), studentId: s.id }))
      .filter((p) => p.item && !isNA(p.item.id, p.studentId));
    if (!pairs.length) { toast('바꿀 칸이 없습니다.', 'error'); return; }
    const allDone = pairs.every((p) => isDone(p.item.id, p.studentId));
    await setCheckMany(pairs, allDone ? CHECK.TODO : CHECK.DONE);
    toast(allDone ? '모두 미완료로 바꿨습니다.' : '모두 완료로 바꿨습니다.');
    return;
  }

  const cell = e.target.closest('.cell');
  if (!cell || cell.classList.contains('na')) return;
  const c = cols[Number(cell.dataset.col)];
  const student = state.students.find((s) => s.id === cell.dataset.student);
  const item = c?.itemFor(student);
  if (!item) return;
  const next = nextCheckState(item, stateOf(item.id, student.id));
  await setCheck(item, student.id, next);
  if (next === CHECK.NA) toast(`${student.name} · 해당없음으로 표시했습니다.`);
}

/* ═══════════ 항목 관리 ═══════════ */
function initManageUI() {
  $('#hw-date').value = todayStr();
  $('#nt-date').value = todayStr();
  $('#duty-prev').addEventListener('click', () => { state.dutyWeek = addDays(state.dutyWeek, -7); renderManage(); });
  $('#duty-next').addEventListener('click', () => { state.dutyWeek = addDays(state.dutyWeek, 7); renderManage(); });
  $('#duty-copy').addEventListener('click', copyLastWeekDuties);

  // 숙제 등록
  $('#hw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#hw-title').value.trim();
    const date = $('#hw-date').value;
    const dueDate = $('#hw-due').value || null;
    if (!title || !date) return;
    if (dueDate && dueDate < date) { toast('마감일이 숙제 날짜보다 빠릅니다.', 'error'); return; }
    await addDoc(col.items, {
      type: TYPE.HOMEWORK, title, date, dueDate, createdAt: serverTimestamp()
    });
    $('#hw-title').value = '';
    $('#hw-due').value = '';
    toast('숙제를 등록했습니다.');
  });

  // 가정통신문 등록
  $('#nt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#nt-title').value.trim();
    const date = $('#nt-date').value;
    const dueDate = $('#nt-due').value || null;
    if (!title || !date) return;
    if (dueDate && dueDate < date) { toast('마감일이 배부일보다 빠릅니다.', 'error'); return; }
    await addDoc(col.items, {
      type: TYPE.NOTICE, title, date, dueDate, closed: false, createdAt: serverTimestamp()
    });
    $('#nt-title').value = '';
    $('#nt-due').value = '';
    toast('가정통신문을 등록했습니다.');
  });

  // 역할 추가
  $('#role-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#role-name').value.trim();
    if (!name) return;
    await addDoc(col.roles, { name, createdAt: serverTimestamp() });
    $('#role-name').value = '';
  });

  // 자격증 추가
  $('#cert-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#cert-name').value.trim();
    if (!name) return;
    await addDoc(col.certs, { name, privileges: {}, createdAt: serverTimestamp() });
    $('#cert-name').value = '';
    toast('자격증을 만들었습니다. 급수별 특권을 적어 주세요.');
  });

  // 급수별 특권 수정
  $('#cert-manage-list').addEventListener('change', async (e) => {
    const input = e.target.closest('.priv-input');
    if (!input) return;
    const { id, level } = input.dataset;
    const cert = state.certs.find((c) => c.id === id);
    const privileges = { ...(cert?.privileges || {}), [level]: input.value.trim() };
    await updateDoc(doc(db, 'certs', id), { privileges });
    toast(`${level}급 특권을 저장했습니다.`);
  });

  // 신용도 기준 점수
  $('#credit-base').addEventListener('change', async (e) => {
    const value = Number(e.target.value);
    if (!Number.isFinite(value)) { toast('숫자를 입력해 주세요.', 'error'); return; }
    await setDoc(doc(db, 'settings', 'credit'), { baseScore: value }, { merge: true });
    toast(`기준 점수를 ${value}점으로 정했습니다.`);
  });

  // 학생 추가
  $('#st-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const number = Number($('#st-number').value);
    const name = $('#st-name').value.trim();
    if (!number || !name) return;
    await addDoc(col.students, { number, name, createdAt: serverTimestamp() });
    $('#st-name').value = '';
    $('#st-number').value = number + 1;
    $('#st-number').focus();
  });

  $('#st-bulk-btn').addEventListener('click', async () => {
    const lines = $('#st-bulk').value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const batch = writeBatch(db);
    let count = 0;
    lines.forEach((line) => {
      const m = line.match(/^(\d+)\s+(.+)$/);
      if (!m) return;
      batch.set(doc(col.students), { number: Number(m[1]), name: m[2].trim(), createdAt: serverTimestamp() });
      count++;
    });
    if (!count) { toast('형식을 확인해 주세요. (예: 1 김민준)', 'error'); return; }
    await batch.commit();
    $('#st-bulk').value = '';
    toast(`${count}명을 추가했습니다.`);
  });

  // 목록 내 버튼 (이벤트 위임)
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;

    if (action === 'del-item') {
      if (!confirm('이 항목과 체크 기록을 함께 삭제할까요?')) return;
      await deleteItem(id);
      toast('삭제했습니다.');
    }
    if (action === 'archive-item') {
      await updateDoc(doc(db, 'items', id), { archived: true });
      toast('보관함으로 옮겼습니다. 통계 탭에서 볼 수 있어요.');
    }
    if (action === 'restore-item') {
      await updateDoc(doc(db, 'items', id), { archived: false });
      toast('항목 관리로 되살렸습니다.');
    }
    if (action === 'toggle-notice') {
      await updateDoc(doc(db, 'items', id), { closed: btn.dataset.closed !== 'true' });
    }
    if (action === 'del-role') {
      if (!confirm('역할을 삭제할까요? (이미 배정된 주간 기록은 그대로 남습니다)')) return;
      await deleteDoc(doc(db, 'roles', id));
    }
    if (action === 'del-cert') {
      if (!confirm('자격증을 삭제할까요? 학생들의 급수 기록도 함께 삭제됩니다.')) return;
      const batch = writeBatch(db);
      batch.delete(doc(db, 'certs', id));
      for (const a of state.awards.values()) {
        if (a.certId === id) batch.delete(doc(db, 'certAwards', a.id));
      }
      await batch.commit();
      toast('삭제했습니다.');
    }
    if (action === 'del-adj') {
      await deleteDoc(doc(db, 'creditAdjustments', id));
      toast('가감점을 취소했습니다.');
    }
    if (action === 'del-student') {
      if (!confirm('학생을 삭제할까요? 이 학생의 체크 기록도 함께 삭제됩니다.')) return;
      const batch = writeBatch(db);
      batch.delete(doc(db, 'students', id));
      for (const c of state.checks.values()) if (c.studentId === id) batch.delete(doc(db, 'checks', c.id));
      for (const i of state.items) if (i.type === TYPE.DUTY && i.studentId === id) batch.delete(doc(db, 'items', i.id));
      for (const a of state.awards.values()) if (a.studentId === id) batch.delete(doc(db, 'certAwards', a.id));
      for (const a of state.adjustments) if (a.studentId === id) batch.delete(doc(db, 'creditAdjustments', a.id));
      await batch.commit();
      toast('삭제했습니다.');
    }
  });

  // 숙제·가정통신문 마감일 변경 (목록에서 바로 수정)
  const onDueChange = async (e) => {
    const input = e.target.closest('.due-input');
    if (!input) return;
    const item = state.items.find((i) => i.id === input.dataset.id);
    const value = input.value || null;
    if (value && item && value < item.date) {
      toast(item.type === TYPE.HOMEWORK
        ? '마감일이 숙제 날짜보다 빠릅니다.'
        : '마감일이 배부일보다 빠릅니다.', 'error');
      input.value = item.dueDate || '';
      return;
    }
    await updateDoc(doc(db, 'items', input.dataset.id), { dueDate: value });
    toast(value ? `마감일을 ${shortDate(value)}로 정했습니다.` : '마감일을 지웠습니다.');
  };
  $('#nt-list').addEventListener('change', onDueChange);
  $('#hw-list').addEventListener('change', onDueChange);

  // 1인 1역 배정 변경
  $('#duty-assign').addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-student]');
    if (!sel) return;
    const studentId = sel.dataset.student;
    const week = state.dutyWeek;
    const itemId = `duty_${week}_${studentId}`;
    if (!sel.value) {
      await deleteItem(itemId);
      return;
    }
    const role = state.roles.find((r) => r.id === sel.value);
    await setDoc(doc(db, 'items', itemId), {
      type: TYPE.DUTY, week, studentId,
      roleId: role.id, roleName: role.name, title: role.name,
      createdAt: serverTimestamp()
    });
  });
}

async function copyLastWeekDuties() {
  const prev = addDays(state.dutyWeek, -7);
  const source = dutiesOf(prev);
  if (!source.length) { toast('지난주 배정이 없습니다.', 'error'); return; }
  const batch = writeBatch(db);
  source.forEach((i) => {
    batch.set(doc(db, 'items', `duty_${state.dutyWeek}_${i.studentId}`), {
      type: TYPE.DUTY, week: state.dutyWeek, studentId: i.studentId,
      roleId: i.roleId, roleName: i.roleName, title: i.roleName,
      createdAt: serverTimestamp()
    });
  });
  await batch.commit();
  toast(`${source.length}명의 배정을 복사했습니다.`);
}

function renderManage() {
  // 숙제 목록 (보관되지 않은 것 중 최근 15개)
  const hw = state.items.filter((i) => i.type === TYPE.HOMEWORK && !isArchived(i))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 15);
  $('#hw-list').innerHTML = hw.length ? hw.map((i) => `
    <li class="dated-item">
      <div class="dated-top">
        <span class="badge-muted">${shortDate(i.date)}</span>
        <span class="grow">${escapeHtml(i.title)}</span>
      </div>
      <div class="dated-bottom">
        <label class="due-label">마감
          <input type="date" class="due-input" data-id="${i.id}"
                 value="${escapeHtml(i.dueDate || '')}" min="${escapeHtml(i.date || '')}" />
        </label>
        <span class="meta">${i.dueDate ? '' : '비우면 숙제 당일까지'}</span>
        <button class="btn ghost small" data-action="archive-item" data-id="${i.id}">보관</button>
        <button class="btn danger" data-action="del-item" data-id="${i.id}">삭제</button>
      </div>
    </li>`).join('') : '<li class="empty">등록된 숙제가 없습니다.</li>';

  // 가정통신문 목록 (보관되지 않은 것만)
  const nt = state.items.filter((i) => i.type === TYPE.NOTICE && !isArchived(i))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  $('#nt-list').innerHTML = nt.length ? nt.map((i) => {
    const over = isOverdue(i);
    const tag = i.closed ? ['closed', '마감'] : over ? ['overdue', '지남'] : ['open', '진행중'];
    return `
    <li class="dated-item">
      <div class="dated-top">
        <span class="state-tag ${tag[0]}">${tag[1]}</span>
        <span class="grow">${escapeHtml(i.title)}</span>
      </div>
      <div class="dated-bottom">
        <span class="meta">배부 ${shortDate(i.date)}</span>
        <label class="due-label">마감
          <input type="date" class="due-input" data-id="${i.id}"
                 value="${escapeHtml(i.dueDate || '')}" min="${escapeHtml(i.date || '')}" />
        </label>
        <button class="btn ghost small" data-action="toggle-notice" data-id="${i.id}" data-closed="${!!i.closed}">
          ${i.closed ? '다시 열기' : '마감'}
        </button>
        <button class="btn ghost small" data-action="archive-item" data-id="${i.id}">보관</button>
        <button class="btn danger" data-action="del-item" data-id="${i.id}">삭제</button>
      </div>
    </li>`;
  }).join('') : '<li class="empty">등록된 통신문이 없습니다.</li>';

  // 역할 목록
  $('#role-list').innerHTML = state.roles.length ? state.roles.map((r) => `
    <li>
      <span class="grow">${escapeHtml(r.name)}</span>
      <button class="btn danger" data-action="del-role" data-id="${r.id}">삭제</button>
    </li>`).join('') : '<li class="empty">역할을 추가해 주세요.</li>';

  // 주간 배정
  $('#duty-week-label').textContent = weekLabel(state.dutyWeek);
  $('#duty-assign').innerHTML = state.students.length ? state.students.map((s) => {
    const cur = dutyOfStudent(s.id, state.dutyWeek);
    const opts = ['<option value="">없음</option>']
      .concat(state.roles.map((r) =>
        `<option value="${r.id}" ${cur?.roleId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`))
      .join('');
    return `<li>
      <span class="who">${escapeHtml(s.number)}번 ${escapeHtml(s.name)}</span>
      <select data-student="${s.id}">${opts}</select>
    </li>`;
  }).join('') : '<li class="empty">학생 명단을 먼저 등록해 주세요.</li>';

  // 학생 목록
  $('#st-list').innerHTML = state.students.length ? state.students.map((s) => `
    <li>
      <span class="grow">${escapeHtml(s.number)}번 ${escapeHtml(s.name)}</span>
      <button class="btn danger" data-action="del-student" data-id="${s.id}">삭제</button>
    </li>`).join('') : '<li class="empty">학생을 추가해 주세요.</li>';

  // 자격증 + 급수별 특권 편집
  $('#cert-manage-list').innerHTML = state.certs.length ? state.certs.map((c) => {
    const filled = LEVELS.filter((lv) => (c.privileges?.[lv] || '').trim()).length;
    const rows = LEVELS.map((lv) => `
      <li>
        <span class="lv-tag lv-${lv}">${lv}급</span>
        <input type="text" class="priv-input" data-id="${c.id}" data-level="${lv}"
               value="${escapeHtml(c.privileges?.[lv] || '')}"
               placeholder="${lv === START_LEVEL ? '시작 급수 · 특권 없이 두어도 됩니다' : '이 급수에서 얻는 특권'}" />
      </li>`).join('');
    return `
      <details class="cert-block">
        <summary>
          <span class="cert-name">${escapeHtml(c.name)}</span>
          <span class="badge-muted">특권 ${filled}개</span>
          <button class="btn danger" data-action="del-cert" data-id="${c.id}">삭제</button>
        </summary>
        <ul class="priv-list">${rows}</ul>
      </details>`;
  }).join('') : '<p class="empty">자격증을 추가해 주세요. (예: 독서 자격증, 구구단 자격증)</p>';
}

/* ═══════════ 자격증 ═══════════ */
function initCertUI() {
  $('#cert-table').addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-cert]');
    if (!sel) return;
    const { cert: certId, student: studentId } = sel.dataset;
    const level = Number(sel.value);
    const student = state.students.find((s) => s.id === studentId);
    const cert = state.certs.find((c) => c.id === certId);
    await setDoc(doc(db, 'certAwards', awardId(certId, studentId)), {
      certId, studentId, level, updatedAt: serverTimestamp()
    });
    toast(`${student?.name} · ${cert?.name} ${level}급`);
  });
}

function renderCerts() {
  const table = $('#cert-table');
  const empty = $('#cert-empty');

  if (!state.students.length || !state.certs.length) {
    table.innerHTML = '';
    empty.hidden = false;
    empty.innerHTML = !state.students.length
      ? '먼저 <strong>항목 관리</strong> 탭에서 학생 명단을 등록해 주세요.'
      : '<strong>항목 관리</strong> 탭에서 자격증을 먼저 만들어 주세요.';
    $('#cert-privileges').innerHTML = '';
    return;
  }
  empty.hidden = true;

  const head = state.certs.map((c) => `
    <th class="col-head">
      <span class="type-tag cert">자격증</span>
      <span class="title">${escapeHtml(c.name)}</span>
    </th>`).join('');

  const body = state.students.map((s) => {
    const cells = state.certs.map((c) => {
      const level = levelOf(c.id, s.id);
      const opts = LEVELS.map((lv) =>
        `<option value="${lv}" ${lv === level ? 'selected' : ''}>${lv}급</option>`).join('');
      return `<td class="lv-cell">
        <select class="lv-select lv-${level}" data-cert="${c.id}" data-student="${s.id}">${opts}</select>
      </td>`;
    }).join('');
    return `<tr><td class="col-student">${escapeHtml(s.number)}번 ${escapeHtml(s.name)}</td>${cells}</tr>`;
  }).join('');

  table.innerHTML = `
    <thead><tr><th class="col-student">학생</th>${head}</tr></thead>
    <tbody>${body}</tbody>`;

  // 급수별 특권 안내
  $('#cert-privileges').innerHTML = state.certs.map((c) => {
    const rows = LEVELS.filter((lv) => (c.privileges?.[lv] || '').trim()).map((lv) => {
      const holders = state.students.filter((s) => levelOf(c.id, s.id) === lv);
      return `<li>
        <span class="lv-tag lv-${lv}">${lv}급</span>
        <span class="grow">${escapeHtml(c.privileges[lv])}</span>
        <span class="meta">${holders.length ? `${holders.map((s) => escapeHtml(s.name)).join(', ')}` : '해당 없음'}</span>
      </li>`;
    }).join('');
    return `
      <div class="priv-group">
        <div class="list-head">${escapeHtml(c.name)}</div>
        <ul class="item-list">${rows || '<li class="empty">아직 등록된 특권이 없습니다.</li>'}</ul>
      </div>`;
  }).join('');
}

/* ═══════════ 신용도 점수표 ═══════════ */
function initCreditUI() {
  $('#credit-base').value = state.baseScore;

  $('#adj-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const studentId = $('#adj-student').value;
    const points = Number($('#adj-points').value);
    const reason = $('#adj-reason').value.trim();
    if (!studentId || !reason || !Number.isFinite(points) || points === 0) {
      toast('학생 · 점수 · 사유를 모두 입력해 주세요.', 'error');
      return;
    }
    await addDoc(col.adjustments, {
      studentId, points, reason, date: todayStr(), createdAt: serverTimestamp()
    });
    $('#adj-points').value = '';
    $('#adj-reason').value = '';
    toast(`${points > 0 ? '+' : ''}${points}점을 반영했습니다.`);
  });

  // 학생 행을 누르면 점수 내역 펼치기
  $('#credit-table').addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-student]');
    if (!row) return;
    const detail = row.nextElementSibling;
    if (detail?.classList.contains('detail-row')) detail.hidden = !detail.hidden;
  });

  $('#credit-csv').addEventListener('click', downloadCreditCsv);
}

function renderCredit() {
  const table = $('#credit-table');

  // 가감점 학생 선택
  const sel = $('#adj-student');
  const keep = sel.value;
  sel.innerHTML = ['<option value="">학생 선택</option>']
    .concat(state.students.map((s) =>
      `<option value="${s.id}">${escapeHtml(s.number)}번 ${escapeHtml(s.name)}</option>`)).join('');
  if (keep) sel.value = keep;

  // 가감점 목록
  $('#adj-list').innerHTML = state.adjustments.length ? state.adjustments.slice(0, 12).map((a) => {
    const student = state.students.find((s) => s.id === a.studentId);
    return `<li>
      <span class="badge-muted">${shortDate(a.date)}</span>
      <span class="pt ${a.points > 0 ? 'plus' : 'minus'}">${a.points > 0 ? '+' : '−'}${Math.abs(a.points)}</span>
      <span class="grow">${escapeHtml(student ? `${student.number}번 ${student.name}` : '(삭제된 학생)')} · ${escapeHtml(a.reason)}</span>
      <button class="btn danger" data-action="del-adj" data-id="${a.id}">취소</button>
    </li>`;
  }).join('') : '<li class="empty">수동으로 조정한 기록이 없습니다.</li>';

  if (!state.students.length) {
    table.innerHTML = '';
    return;
  }

  const rows = state.students.map((s) => ({ student: s, ...scoreOf(s.id) }));

  table.innerHTML = `
    <thead>
      <tr>
        <th class="col-student">학생</th>
        <th>기준</th><th>획득</th><th>감점</th><th>총점</th><th></th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(({ student, plus, minus, total, events }) => `
        <tr data-student="${student.id}">
          <td class="col-student">${escapeHtml(student.number)}번 ${escapeHtml(student.name)}</td>
          <td class="num">${state.baseScore}</td>
          <td class="num pt plus">+${plus}</td>
          <td class="num pt minus">${minus === 0 ? '0' : `−${Math.abs(minus)}`}</td>
          <td class="num total ${total >= state.baseScore ? 'up' : 'down'}">${total}</td>
          <td class="meta">내역 ${events.length}건 ▾</td>
        </tr>
        <tr class="detail-row" hidden>
          <td colspan="6">
            ${events.length ? `<ul class="event-list">${events.slice(0, 40).map((ev) => `
              <li>
                <span class="badge-muted">${ev.date ? shortDate(ev.date) : '-'}</span>
                <span class="pt ${ev.points > 0 ? 'plus' : 'minus'}">${ev.points > 0 ? '+' : '−'}${Math.abs(ev.points)}</span>
                <span class="grow">${escapeHtml(ev.reason)}</span>
              </li>`).join('')}</ul>` : '<p class="empty">아직 점수에 반영된 일이 없습니다.</p>'}
          </td>
        </tr>`).join('')}
    </tbody>`;
}

function downloadCreditCsv() {
  if (!state.students.length) { toast('내보낼 데이터가 없습니다.', 'error'); return; }
  const header = ['번호', '이름', '기준 점수', '획득', '감점', '총점'];
  const lines = [header.join(',')].concat(state.students.map((s) => {
    const { plus, minus, total } = scoreOf(s.id);
    return [s.number, s.name, state.baseScore, plus, minus, total].join(',');
  }));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `신용도_점수표_${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('신용도 점수표를 내려받았습니다.');
}

/* ═══════════ 통계 ═══════════ */
function initStatsUI() {
  const sel = $('#stat-range');
  sel.addEventListener('change', () => {
    $('#stat-custom').hidden = sel.value !== 'custom';
    renderStats();
  });
  $('#stat-from').value = monthStart();
  $('#stat-to').value = todayStr();
  $('#stat-from').addEventListener('change', renderStats);
  $('#stat-to').addEventListener('change', renderStats);
  $('#stat-csv').addEventListener('click', downloadCsv);
}

function statRange() {
  const today = todayStr();
  switch ($('#stat-range').value) {
    case 'week': {
      const ws = weekStart(today);
      return { from: ws, to: addDays(ws, 6), label: `이번 주 (${weekLabel(ws)})` };
    }
    case 'month': {
      const ms = monthStart(today);
      const d = new Date(Number(ms.slice(0, 4)), Number(ms.slice(5, 7)), 0);
      return { from: ms, to: `${ms.slice(0, 7)}-${String(d.getDate()).padStart(2, '0')}`,
        label: `이번 달 (${ms.slice(0, 7)})` };
    }
    case 'custom': {
      const from = $('#stat-from').value || '0000-01-01';
      const to = $('#stat-to').value || '9999-12-31';
      return { from, to, label: `${from} ~ ${to}` };
    }
    default:
      return { from: '0000-01-01', to: '9999-12-31', label: '학기 전체' };
  }
}

function computeStats() {
  const { from, to } = statRange();
  const inRange = (d) => d && d >= from && d <= to;

  const homework = state.items.filter((i) => i.type === TYPE.HOMEWORK && inRange(i.date));
  const notices = state.items.filter((i) => i.type === TYPE.NOTICE && inRange(i.date));
  const duties = state.items.filter((i) => i.type === TYPE.DUTY && inRange(i.week));

  return state.students.map((s) => {
    // 해당없음으로 표시한 항목은 분모에서 뺀다
    const count = (items) => {
      let done = 0, total = 0;
      items.forEach((i) => {
        if (isNA(i.id, s.id)) return;
        total++;
        if (isDone(i.id, s.id)) done++;
      });
      return { done, total };
    };
    const hw = count(homework);
    const nt = count(notices);
    const dt = count(duties.filter((d) => d.studentId === s.id));
    const all = {
      done: hw.done + nt.done + dt.done,
      total: hw.total + nt.total + dt.total
    };
    return { student: s, hw, nt, dt, all };
  });
}

function rateCell({ done, total }) {
  const r = rate(done, total);
  if (r == null) return '<td class="num">-</td>';
  const cls = r >= 90 ? 'rate-good' : r >= 70 ? 'rate-mid' : 'rate-low';
  return `<td class="num"><span class="${cls}">${r}%</span><span class="frac">${done}/${total}</span></td>`;
}

function renderStats() {
  const { label } = statRange();
  $('#stat-period').textContent = `기간: ${label}`;

  const rows = computeStats();
  const table = $('#stat-table');
  if (!rows.length) {
    table.innerHTML = '';
    return;
  }

  table.innerHTML = `
    <thead>
      <tr>
        <th class="col-student">학생</th>
        <th>숙제 제출률</th>
        <th>가정통신문 회수율</th>
        <th>1인 1역 완료율</th>
        <th>종합</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((r) => `
        <tr>
          <td class="col-student">${escapeHtml(r.student.number)}번 ${escapeHtml(r.student.name)}</td>
          ${rateCell(r.hw)}${rateCell(r.nt)}${rateCell(r.dt)}${rateCell(r.all)}
        </tr>`).join('')}
    </tbody>`;
}

/** 보관함 - 마감 후 하루가 지나 항목 관리에서 자동으로 빠진 숙제·가정통신문 */
function renderArchive() {
  const box = $('#archive-list');
  if (!box) return;
  const items = state.items
    .filter((i) => (i.type === TYPE.HOMEWORK || i.type === TYPE.NOTICE) && isArchived(i))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  box.innerHTML = items.length ? items.map((i) => {
    const meta = i.type === TYPE.HOMEWORK ? homeworkMeta(i) : noticeMeta(i);
    return `
    <li class="dated-item">
      <div class="dated-top">
        <span class="type-tag ${i.type}">${TYPE_LABEL[i.type]}</span>
        <span class="grow">${escapeHtml(i.title)}</span>
      </div>
      <div class="dated-bottom">
        <span class="meta">${escapeHtml(meta)}</span>
        <button class="btn ghost small" data-action="restore-item" data-id="${i.id}">항목 관리로 되살리기</button>
        <button class="btn danger" data-action="del-item" data-id="${i.id}">삭제</button>
      </div>
    </li>`;
  }).join('') : '<li class="empty">보관된 항목이 없습니다.</li>';
}

function downloadCsv() {
  const rows = computeStats();
  if (!rows.length) { toast('내보낼 데이터가 없습니다.', 'error'); return; }
  const { from, to, label } = statRange();
  const pct = ({ done, total }) => (total ? Math.round((done / total) * 100) : '');
  const header = ['번호', '이름', '숙제 제출', '숙제 전체', '숙제 %',
    '통신문 회수', '통신문 전체', '통신문 %', '1인1역 완료', '1인1역 전체', '1인1역 %', '종합 %'];
  const lines = [header.join(',')].concat(rows.map((r) => [
    r.student.number, r.student.name,
    r.hw.done, r.hw.total, pct(r.hw),
    r.nt.done, r.nt.total, pct(r.nt),
    r.dt.done, r.dt.total, pct(r.dt),
    pct(r.all)
  ].join(',')));

  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `체크리스트_통계_${from}_${to}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`${label} 통계를 내려받았습니다.`);
}

/* ─────────── 시작 (선언이 모두 끝난 뒤 실행) ─────────── */
if (sessionStorage.getItem(AUTH_KEY) === 'ok') openApp();
