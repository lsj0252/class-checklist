# 우리 반 체크리스트

숙제 제출 · 가정통신문 회수 · 1인 1역 주간 활동을 한 곳에서 관리하는 학급 운영 웹앱입니다.
빌드 도구 없이 **HTML + JS + Firebase(Firestore)** 만으로 동작하며 GitHub Pages에 그대로 올릴 수 있습니다.

## 화면

| 화면 | 파일 | 설명 |
|---|---|---|
| 진입점 | `index.html` | 교사 / 학생 선택 |
| 교사용 대시보드 | `teacher.html` | 홈 · 학생별 체크 · 자격증 · 신용도 · 항목 관리 · 통계 (6개 탭) |
| 학생용 현황 | `student.html` | 이름 선택 로그인 후 본인 현황 · 자격증 · 신용도 점수 열람 |

## 1. Firebase 설정

1. [Firebase 콘솔](https://console.firebase.google.com) → `class-checklist` 프로젝트 → **프로젝트 설정 → 내 앱 → SDK 설정 및 구성**에서 `firebaseConfig` 값을 복사합니다.
2. `js/firebase-config.js` 를 열어 `PASTE_...` 부분을 붙여넣습니다.
3. 같은 파일의 `TEACHER_PASSWORD` 를 원하는 비밀번호로 바꿉니다.

> ⚠️ 교사 비밀번호는 정적 파일에 그대로 들어갑니다. 브라우저 개발자 도구로 확인할 수 있으므로
> **"학생이 실수로 교사 화면에 들어가는 것을 막는 용도"** 로만 생각해 주세요.
> 외부인 차단까지 필요하면 Firebase Authentication(이메일/비밀번호 로그인)을 추가해야 합니다.

### Firestore 보안 규칙

Firestore → 규칙 탭에 아래를 붙여넣습니다. (`firestore.rules` 파일과 동일)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{doc=**} {
      allow read, write: if true;
    }
  }
}
```

이 규칙은 **주소를 아는 사람은 누구나 읽고 쓸 수 있는** 상태입니다.
학급 내부용 소규모 앱이라 편의를 우선한 설정이며, 학생 이름 외의 민감정보는 넣지 않는 것을 권장합니다.
나중에 보안을 강화하려면 Firebase Authentication(익명 로그인 또는 교사 계정)을 붙이고
`allow write: if request.auth != null;` 형태로 바꾸면 됩니다.

## 2. 로컬에서 실행

ES 모듈을 쓰기 때문에 파일을 더블클릭하면 동작하지 않습니다. 간단한 로컬 서버를 띄우세요.

```bash
npx serve .
```

Python이 설치되어 있다면 이것도 됩니다.

```bash
python -m http.server 8000
```

터미널에 표시된 주소(`http://localhost:3000` 또는 `http://localhost:8000`)로 접속합니다.

## 3. GitHub Pages 배포

```bash
git init
git add .
git commit -m "우리 반 체크리스트 최초 커밋"
git branch -M main
git remote add origin https://github.com/<사용자명>/class-checklist.git
git push -u origin main
```

GitHub 저장소 → **Settings → Pages → Source: Deploy from a branch → main / (root)** 로 설정하면
`https://<사용자명>.github.io/class-checklist/` 주소로 열립니다.

## 4. 처음 사용 순서

1. 교사 화면 로그인 → **항목 관리** 탭
2. **학생 명단**에 13명 등록 (`여러 명 한 번에 추가`로 `1 김민준` 형식 붙여넣기 가능)
3. **1인 1역** 역할 목록 등록 → 이번 주 배정
4. 매일 **숙제** 등록, 통신문이 나가면 **가정통신문** 등록 (마감일은 선택 사항이며, 목록에서 나중에 바꿀 수 있습니다)
5. **학생별 체크** 탭에서 칸을 눌러 체크
   - 숙제 · 1인 1역: `X` ↔ `O`
   - 가정통신문: `X` → `O` → `/` (해당없음) → `X`
     특정 학생에게만 나가는 통신문이면 나머지 학생을 `/` 로 두세요.
     통계 분모와 신용도 점수에서 함께 빠집니다.
6. 학생들은 `student.html` 에서 이름을 눌러 본인 현황 확인

## 데이터 구조 (Firestore)

| 컬렉션 | 문서 ID | 필드 |
|---|---|---|
| `students` | 자동 | `number`, `name`, `createdAt` |
| `certs` | 자동 | `name`, `privileges`(`{"1":"…", …, "10":"…"}` 급수별 특권), `createdAt` |
| `certAwards` | `{certId}__{studentId}` | `certId`, `studentId`, `level`(1~10), `updatedAt` - 기록이 없으면 10급 |
| `creditAdjustments` | 자동 | `studentId`, `points`(±), `reason`, `date` - 수동 가감점 |
| `settings` | `credit` | `baseScore` - 신용도 기준 점수 (기본 100) |
| `roles` | 자동 | `name`, `createdAt` - 1인 1역 역할 목록 |
| `items` | 숙제·통신문은 자동 / 1인 1역은 `duty_{주시작일}_{학생ID}` | `type`(`homework`\|`notice`\|`duty`), `title`, `date`(숙제는 숙제일, 통신문은 배부일), `dueDate`(마감일 · 선택 - 숙제는 비우면 숙제 당일이 마감), `week`(1인 1역, 그 주 월요일), `closed`(통신문 마감 여부), `studentId`·`roleId`·`roleName`(1인 1역) |
| `checks` | `{itemId}__{studentId}` | `itemId`, `studentId`, `type`, `date`, `done`, `na`(해당없음 · 가정통신문 전용), `checkedAt` |

- 문서 ID를 조합키로 고정해 **중복 체크 기록이 생기지 않습니다.**
- `checks.checkedAt` 에 서버 타임스탬프를 남기고 `date` 를 함께 복사해 두어, 통계 탭에서 기간별 집계가 가능합니다.
- 주간 데이터의 키는 **그 주의 월요일 날짜**(`YYYY-MM-DD`)입니다. 주가 바뀌면 새 항목이 만들어지므로 자동으로 리셋됩니다.

## 통계 탭

- 기간 필터: 이번 주 / 이번 달 / 학기 전체 / 직접 입력
- 학생별 숙제 제출률 · 통신문 회수율 · 1인 1역 완료율 · 종합
- 90% 이상 초록, 70% 이상 주황, 그 미만 빨강으로 표시
- **CSV 내려받기** 로 엑셀에서 열어 생활기록부 작성 참고자료로 쓸 수 있습니다.

## 자격증 탭

- **항목 관리** 탭에서 자격증을 만들고, 급수(1~10급)마다 어떤 특권을 주는지 적어 둡니다. 비워 둔 급수는 특권 없이 넘어갑니다.
- 모든 학생은 **10급에서 시작**해 **1급**까지 올라갑니다. **자격증** 탭의 표에서 학생별 급수를 바꾸면 학생 화면에 바로 반영됩니다.
- 학생 화면에는 **지금까지 획득한 특권**(10급 → 현재 급수)만 보입니다. 아직 못 딴 급수의 특권 내용은 감춰지고, 다음 목표 급수 번호만 알려 줍니다.

## 신용도 점수표

기준 점수(기본 100점, **항목 관리** 탭에서 변경)에서 시작해 자동으로 오르내립니다.

| 상황 | 점수 |
|---|---|
| 숙제를 마감일까지 제출 | **+1** |
| 가정통신문을 마감일까지 회수 | **+1** |
| 숙제를 마감일이 지나서 냄 (또는 지금까지 미제출) | **−2** |
| 가정통신문을 마감일이 지나서 냄 (또는 지금까지 미회수) | **−2** |
| 그 주가 끝났는데 1인 1역 미완료 | **−2** |

- 판정 기준은 **체크한 시각**(`checks.checkedAt`)입니다. 며칠 뒤 몰아서 체크하면 늦게 낸 것으로 잡히니, 그럴 때는 **수동 가감점**으로 조정하세요.
- 숙제는 마감일을 비워 두면 **숙제 당일**이 마감일입니다. 그날 안에 체크하지 않으면 다음 날부터 미제출로 −2가 됩니다.
- **해당없음(`/`)으로 표시한 가정통신문은 점수에 전혀 반영되지 않습니다.** 통계 분모에서도 빠집니다.
- 학생 행을 누르면 점수가 어떻게 계산됐는지 항목별 내역이 펼쳐집니다. 학생 화면에도 같은 내역이 보입니다.

## 학기 정리

학기가 끝나면 Firestore 콘솔에서 컬렉션을 내보내거나(백업), 통계 탭에서 CSV를 받아 두고
`items` / `checks` 를 비우면 새 학기를 시작할 수 있습니다.
