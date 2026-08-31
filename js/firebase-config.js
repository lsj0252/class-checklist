// ─────────────────────────────────────────────────────────────
//  Firebase 설정
//  Firebase 콘솔 > 프로젝트 설정 > 내 앱 > SDK 설정 및 구성 에서
//  firebaseConfig 값을 복사해 아래에 붙여넣으세요.
// ─────────────────────────────────────────────────────────────
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyBFrFGxUPhPejeih-8ofz7_x-uYkCsRCKs',
  authDomain: 'class-checklist-911ec.firebaseapp.com',
  projectId: 'class-checklist-911ec',
  storageBucket: 'class-checklist-911ec.firebasestorage.app',
  messagingSenderId: '784640813511',
  appId: '1:784640813511:web:d7abef2bea380af14e11e2'
};

// 교사용 관리자 비밀번호 (원하는 값으로 바꿔 주세요)
// ※ 정적 사이트라 소스에 그대로 노출됩니다. 외부인 차단용이 아니라
//   "학생이 실수로 교사 화면에 들어가는 것"을 막는 용도입니다.
export const TEACHER_PASSWORD = '5118';

// 학급 정보 (화면 상단 표시용)
export const CLASS_NAME = '6학년 우리 반';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
