# 아재개그 생성기 (Web)

Google Gemini (`gemini-2.5-flash-lite`) 로 한국어 아재개그를 만들어 카드로 보여주고, 마음에 드는 항목만 로컬에 저장하는 단일 페이지 웹앱입니다. 별도 빌드 도구 없이 정적 호스팅(또는 `file://`) 으로 그대로 동작합니다.

## 주요 기능

- **생성**: 키워드 기반 한 개 생성 / 한 번에 2~30 개 일괄 생성
- **임시 목록**: 생성된 결과는 메인 화면 하단에 카드로 누적되어, **저장하기 / 버리기** 를 항목별로 선택. **전체 삭제** 는 2단계 확인.
- **저장한 개그**: 별표 토글, 수정, 삭제, 카테고리 칩 필터, 별표만 보기 필터, FAB 로 직접 추가
- **가져오기 / 내보내기**: 내장 시드 가져오기, JSON 파일 가져오기 (중복 제거), JSON 내보내기
- **설정**: Gemini API 키를 브라우저 `localStorage` 에 저장 / 삭제

## 사용 방법

1. [Google AI Studio](https://aistudio.google.com/app/apikey) 에서 Gemini API 키 발급 (키는 `AIzaSy...` 로 시작).
2. `index.html` 을 그대로 열거나 정적 서버에 배포.
3. 우측 상단 ⚙️ 에서 키 입력 → 저장.
4. 메인에서 키워드(선택) 입력 후 **아재개그 만들기** 또는 **N개 생성**.

> 로컬 파일(`file://`)에서 열면 일부 브라우저가 `fetch("./seed_jokes.json")` 을 차단할 수 있습니다. 시드 가져오기가 실패하면 간단히 정적 서버로 띄우세요:
>
> ```bash
> # Python
> python -m http.server 8000
> # Node (npx)
> npx serve .
> ```

## 보안 주의

- API 키는 브라우저 `localStorage` 에 **평문** 으로 저장됩니다. 모든 호출은 브라우저에서 직접 Google API 로 나가므로, 키가 네트워크 탭이나 저장소에서 노출됩니다.
- **공용 PC 사용 금지**. 사용 후 ⚙️ 에서 키 삭제.
- 본인 전용 / 개인용 환경에서만 사용하세요. 서비스 형태로 배포하려면 키를 서버 측 프록시에 보관하세요.

## 파일 구성

```
web/
  index.html        ─ 마크업 + 템플릿
  styles.css        ─ 스타일 (라이트/다크 자동 대응)
  app.js            ─ 상태/라우팅/뷰 로직
  gemini.js         ─ Gemini API 래퍼 (단일/배치, 429 재시도)
  storage.js        ─ localStorage 즐겨찾기 저장소
  seed_jokes.json   ─ 내장 시드 데이터
```

## 기술 메모

- 빌드 없음, 의존성 없음. ES 모듈만 사용.
- `Gemini responseSchema` 를 사용해 5개 필드(`type/category/question/answer/explanation`) 보장.
- 429 (분당 한도) 시 `Retry-After` / 본문 메시지를 파싱해 카운트다운 후 1회 자동 재시도.
- 즐겨찾기 중복 제거 키: `question.trim() + '\u0001' + answer.trim()`.

## 라이선스

개인 사용용. 무보증.
