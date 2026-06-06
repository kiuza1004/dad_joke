# 아재개그 생성기 (Web)

Google Gemini (`gemini-2.5-flash-lite`) 로 한국어 아재개그를 만들어 카드로 보여주고, 마음에 드는 항목만 로컬에 저장하는 단일 페이지 웹앱입니다.

API 키는 **Vercel 서버리스 함수 (`api/generate.js`)** 가 서버 측에서만 사용하며, 브라우저 / 저장소 / Git 어디에도 노출되지 않습니다.

## 주요 기능

- **생성**: 키워드 기반 한 개 생성 / 한 번에 2~30 개 일괄 생성
- **임시 목록**: 생성 결과는 메인 하단에 카드로 누적, 항목별 **저장하기 / 버리기**, **전체 삭제** 2단계 확인
- **저장한 개그**: 별표, 수정, 삭제, 카테고리 칩 필터, 별표 필터, FAB 로 직접 추가
- **가져오기 / 내보내기**: 내장 시드, JSON 파일 가져오기 (중복 제거), JSON 내보내기
- **키 관리 UI 없음** — 키는 서버 환경변수에 보관됩니다

## 배포 (Vercel)

1. 이 저장소를 Vercel에 연결 (Import Project → Continue)
2. **Settings → Environment Variables** 에서 다음 추가:
   - Name: `GEMINI_API_KEY`
   - Value: `AIzaSy...` (본인 키)
   - Environment: Production / Preview / Development 전부 체크
3. 다시 배포 (Redeploy) — `api/generate.js` 가 자동으로 함수로 실행됨

[Google AI Studio](https://aistudio.google.com/app/apikey) 에서 키 발급.

## 로컬 개발

서버리스 함수가 있어 정적 서버로는 동작하지 않습니다. Vercel CLI 사용:

```bash
npm i -g vercel
vercel login
vercel link    # 기존 프로젝트와 연결
vercel env pull .env.local   # 환경변수 내려받기
vercel dev     # http://localhost:3000
```

## 보안

- API 키는 **서버 환경변수에만** 존재 — 클라이언트 코드, localStorage, 네트워크 응답 어디에도 평문으로 노출되지 않음
- 클라이언트는 `/api/generate` 로 `{ mode, keyword, count }` 만 전송
- Rate limit (429) 시 `retryAfterSeconds` 만 전달되며 키 정보는 절대 응답하지 않음
- 저장소(Git/Vercel 빌드 로그) 어디에도 키가 들어가지 않음 — `.gitignore` 와 환경변수 분리 보장
- **공개 배포 시 주의**: Vercel 프로젝트 URL은 누구나 호출할 수 있으므로 본인 키의 분당/일일 한도가 모두 소진될 수 있음. 아래의 간이 액세스 컨트롤 두 가지(또는 Vercel **Deployment Protection** — Pro 플랜) 중 하나 이상을 활용하세요.

## 간이 액세스 컨트롤 (선택)

`api/generate.js` 의 `checkAccess()` 가 다음 두 환경변수를 함께 (AND) 검사합니다. 둘 다 미설정이면 기존처럼 누구나 호출할 수 있습니다.

### 1) `ALLOWED_ORIGINS` — Origin/Referer 화이트리스트

쉼표 구분, 클라이언트 코드 수정 불필요.

- Name: `ALLOWED_ORIGINS`
- Value 예: `https://kiuza1004.github.io,https://dad-joke.vercel.app`

브라우저가 보내는 `Origin`/`Referer` 헤더 중 하나라도 일치하면 통과. `curl` 같은 직접 호출은 차단됩니다(브라우저 외 호출엔 헤더가 없거나 위조 가능 — 강한 보안은 아님).

### 2) `ACCESS_TOKEN` — 공유 비밀 토큰

- Name: `ACCESS_TOKEN`
- Value: 임의의 긴 문자열

설정 시 클라이언트가 `x-access-token` 헤더로 같은 값을 보내야 합니다. `index.html` 의 주석을 풀고 토큰을 넣으면 됩니다:

```html
<meta name="x-access-token" content="여기에-토큰" />
```

⚠️ 페이지 소스에 토큰이 보이므로 진짜 비밀은 아닙니다. **공개되지 않은 URL** (Deployment Protection 또는 비공개 링크 공유) 과 함께 사용해야 의미가 있습니다.

## GitHub Pages 사용 불가

GitHub Pages는 서버리스 함수를 지원하지 않아 이 구조에서는 동작하지 않습니다. Vercel 또는 동등한 함수 호스팅 환경(Cloudflare Workers, Netlify Functions 등)을 사용하세요.

## 파일 구성

```
web/
  index.html        ─ 마크업 + 템플릿
  styles.css        ─ 스타일 (라이트/다크 자동 대응)
  app.js            ─ 상태 / 라우팅 / 뷰
  gemini.js         ─ /api/generate 호출 래퍼
  storage.js        ─ localStorage 즐겨찾기 저장소 (키는 다루지 않음)
  seed_jokes.json   ─ 내장 시드 데이터
  api/
    generate.js     ─ Vercel 서버리스 프록시 (Gemini 호출)
```

## 라이선스

개인 사용용. 무보증.
