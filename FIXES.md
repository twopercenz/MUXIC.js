# MUXIC.js 개편 계획 — music.player의 추출 계층으로 쓰기

대상 저장소: `twopercenz/MUXIC.js` (주 작업), `twopercenz/music.player` (연동)

---

## 0. 목표와 전제

**목표**: MUXIC.js를 music.player가 `import`해서 쓸 수 있는 오디오 추출 라이브러리로 재설계한다.
MUXIC의 **인터페이스 모양**(extractor 레지스트리)은 살리고, **엔진**은 music.player `lib/extract.ts`가 이미 실전에서 검증한 yt-dlp + ffmpeg를 이식한다.

**전제 — 현재 MUXIC.js 구현을 그대로 쓰면 안 되는 이유** (이 세 줄이 아래 설계 전체의 근거다):

1. `youtubei.js`가 뱉는 googlevideo 직링크는 요청한 서버 IP에 묶인다. 브라우저에 넘겨줄 수 없고 결국 서버가 프록시해야 한다.
2. 직링크는 대개 webm/opus다. music.player는 지금 mp3 192k로 정규화하기 때문에 Safari에서 재생이 깨지지 않는다. 이 보장을 잃는다.
3. `src/index.js`의 `download()`는 `Buffer.from(await res.arrayBuffer())` — 파일 전체를 메모리에 올린다. music.player의 progressive streaming과 정반대다.

따라서 **youtubei.js는 기본 엔진이 아니라 선택적 fast-path로만 남긴다.**

---

## 1. 먼저 결정할 것 (구현 전에 답하고 시작)

- [ ] **별도 저장소로 유지할지, music.player 안으로 흡수할지.**
  개인 프로젝트에서 두 repo를 `bun link`로 묶으면 버전/링크 관리 비용이 실제 이득보다 클 수 있다.
  흡수한다면 이 문서의 `src/*` 경로를 전부 `music.player/lib/muxic/*` 로 읽으면 된다. 나머지 설계는 동일.
- [ ] **TypeScript로 전환할지.** music.player가 TS이므로 타입이 필요하다. TS 전환 또는 `types/index.d.ts` 수동 작성 중 택일. (전환 권장)
- [ ] `music.player/lib/youtube.ts`의 `matchYoutubeTrack`이 살아있는 코드인지 확인.
  `lib/resolve-audio.ts` 주석에는 "매칭 단계는 이제 없다"고 적혀 있는데 `app/api/resolve/route.ts`는 아직 호출한다. 죽은 경로면 이번에 같이 정리.

---

## 2. MUXIC.js 재설계

### 2.1 핵심 인터페이스 교체

현재 `src/index.js`의 `extract(url) → { formats }`는 "직링크를 뽑아 넘긴다" 모델이다. music.player가 필요한 건 다르다:

```js
// 새 시그니처
openAudioStream(input, { signal, engine }) 
  → Promise<{ stream: ReadableStream<Uint8Array>, contentType: string, abort: () => void }>
```

핵심 차이: **URL 배열이 아니라 이미 열린 바이트 스트림을 돌려준다.** 호출자는 그대로 HTTP 응답 body에 꽂거나 `.tee()`한다.

### 2.2 개념 분리 — resolver / engine

레지스트리를 두 층으로 나눈다. 지금 `src/extractors/youtube.js`는 이 둘이 섞여 있다.

- **resolver**: URL → 정규화된 식별자. 순수 함수, 네트워크 없음. (`{ test(url), resolve(url) → { site, id } }`)
- **engine**: 식별자 → 바이트 스트림. 부수효과 전부 여기. (`{ open({ site, id }, opts) → { stream, contentType, abort } }`)

이렇게 나눠야 유튜브 URL 파싱 로직은 테스트가 쉬운 순수 함수로 남고, 무거운 프로세스 관리는 엔진 하나에 격리된다.

### 2.3 파일 구조

```
src/
  index.js            # registerResolver / registerEngine / openAudioStream
  resolvers/
    youtube.js        # 기존 extractors/youtube.js 에서 extractId 부분만 이관
  engines/
    ytdlp-ffmpeg.js   # 신규 — music.player/lib/extract.ts 에서 이식 (기본 엔진)
    innertube.js      # 기존 youtubei.js 코드 — 선택적, 기본값 아님
  concurrency.js      # 동시 실행 슬롯
  errors.js           # 에러 클래스 + 코드
test/
  resolvers.test.js
  concurrency.test.js
  index.test.js       # 기존 파일 — 레지스트리 디스패치 테스트만 남기고 pickFormat 테스트 삭제
```

### 2.4 `src/errors.js` — 신규 파일

**중요: 라이브러리에 한국어 문구를 넣지 말 것.** 현재 `lib/extract.ts`의 `summarizeYtDlpError()`는 한국어 메시지를 직접 만드는데, 그건 앱의 책임이다. 라이브러리는 **코드만** 던진다.

```js
// src/errors.js
export class ExtractionError extends Error {
  /** @param {'BOT_CHECK'|'RELOAD_REQUIRED'|'PRIVATE'|'UNAVAILABLE'|'GEO_BLOCKED'|'TIMEOUT'|'SPAWN_FAILED'|'UNKNOWN'} code */
  constructor(code, { cause, stderr } = {}) {
    super(`extraction failed: ${code}`);
    this.name = 'ExtractionError';
    this.code = code;
    this.stderr = stderr;
    this.cause = cause;
  }
}

export class TooManyExtractionsError extends Error {
  constructor(limit) {
    super(`concurrent extraction limit reached (${limit})`);
    this.name = 'TooManyExtractionsError';
    this.limit = limit;
  }
}

/** stderr → code. 기존 summarizeYtDlpError의 정규식을 그대로 옮기되 반환값만 코드로 바꾼다. */
export function classifyYtDlpError(stderr) {
  if (/sign in to confirm/i.test(stderr)) return 'BOT_CHECK';
  if (/page needs to be reloaded/i.test(stderr)) return 'RELOAD_REQUIRED';
  if (/private video/i.test(stderr)) return 'PRIVATE';
  if (/video unavailable/i.test(stderr)) return 'UNAVAILABLE';
  if (/not available in your country|geo/i.test(stderr)) return 'GEO_BLOCKED';
  return 'UNKNOWN';
}
```

### 2.5 `src/concurrency.js` — 신규 파일

`lib/extract.ts`의 `MAX_CONCURRENT_EXTRACTIONS` / `activeExtractions` / `releaseSlot` 로직을 이관. 상수를 하드코딩하지 말고 생성자 인자로 받는다 (앱마다 컨테이너 사양이 다름).

```js
export function createSlots(limit) {
  let active = 0;
  return {
    acquire() {
      if (active >= limit) throw new TooManyExtractionsError(limit);
      active++;
      let released = false;
      return () => { if (!released) { released = true; active--; } };
    },
    get active() { return active; },
  };
}
```

### 2.6 `src/engines/ytdlp-ffmpeg.js` — 이식 범위

`music.player/lib/extract.ts`에서 **가져올 것**:

- `getCookieArgs()` / `getWritableCookiesFile()` — Render read-only Secret File 우회 포함. 단, 환경변수 이름을 옵션으로 받게 (`{ cookiesFile, cookiesFromBrowser }`), `process.env` 직접 읽기 제거.
- yt-dlp 인자 전체 (`-f bestaudio/best`, `--js-runtimes bun`, `--extractor-args youtube:player_client=android,ios,web`). **주석도 같이 옮길 것** — 왜 이 조합인지가 주석에만 있다.
- ffmpeg 인자 (`-vn -f mp3 -ab 192k`). 비트레이트/포맷은 옵션화.
- `killAll()` 양쪽 SIGKILL 정리 + `signal` 연동 + `ffmpeg.once('close', killAll)`.
- 성공/실패 레이스 판정 블록 전체 (ffmpeg 첫 바이트 vs yt-dlp non-zero exit, 45초 백스톱). `unshift`로 peek하는 부분 포함 — 이거 빠뜨리면 첫 청크가 사라진다.

**가져오지 말 것** (앱에 남긴다, 3장 참고):

- `pendingExtractions` / `claimPendingStream` / `stashForReuse` — Next.js 라우트의 probe 사정이라 라이브러리 관심사가 아니다.
- tmp 캐시 tee (`getCacheWritePath` / `commitCacheWrite` / `discardCacheWrite`) — 라이브러리는 스트림 하나만 돌려주고, 호출자가 `.tee()`한다.
- 한국어 에러 문구.

### 2.7 삭제할 것

- `src/index.js`의 `download()` — 전량 메모리 버퍼링. 대체 없이 삭제.
- `src/index.js`의 `pickFormat()` / `sanitizeFilename()` — 직링크 모델 전용.
- `test/index.test.js`의 `pickFormat` 테스트 2건.

---

## 3. music.player 쪽 변경

### 3.1 `lib/extract.ts` — 대폭 축소

남는 책임은 네 가지뿐:

1. MUXIC 엔진 호출
2. probe stash (`pendingExtractions` 맵 + 15초 타임아웃 정리) — 그대로 유지
3. 스트림 tee → `lib/audio-cache.ts` 기록
4. `ExtractionError.code` → 한국어 문구 매핑

```ts
// music.player/lib/extract.ts 상단에 신설
import { ExtractionError } from "muxic/errors";

const ERROR_MESSAGES: Record<string, string> = {
  BOT_CHECK: "YouTube가 봇 감지로 요청을 막았습니다. YTDLP_COOKIES_FILE 설정이 필요합니다 (README 참고).",
  RELOAD_REQUIRED: "YouTube 쪽 일시적 오류입니다 (yt-dlp 추출기 이슈). 잠시 후 다시 시도해보세요.",
  PRIVATE: "비공개 영상이라 재생할 수 없습니다.",
  UNAVAILABLE: "삭제되었거나 재생할 수 없는 영상입니다.",
  GEO_BLOCKED: "지역 제한으로 재생할 수 없는 영상입니다.",
  TIMEOUT: "추출 시간이 초과되었습니다.",
  SPAWN_FAILED: "추출 프로세스를 실행할 수 없습니다.",
  UNKNOWN: "오디오 추출에 실패했습니다.",
};
```

tee는 라이브러리에서 돌려받은 뒤 앱에서 처리한다. 기존의 수동 `ffmpeg.stdout.on('data')` → 두 곳에 write 하던 코드는 표준 `ReadableStream.tee()`로 대체 가능하다. 단 **`finalizeCache()`의 커밋/폐기 조건**(ffmpeg exit code + 파일 write finish 둘 다 만족)은 유지해야 한다 — 중간에 끊긴 mp3가 캐시에 남으면 다음 재생이 조용히 깨진다.

### 3.2 `package.json`

```json
"dependencies": {
  "muxic": "github:twopercenz/MUXIC.js#main"
}
```

(2장 결정에서 "흡수"를 골랐으면 이 줄 불필요.)

### 3.3 변경 없는 것

- `Dockerfile` — yt-dlp / ffmpeg 여전히 필요.
- `app/api/extract/route.ts`의 Range/206 처리 — 캐시 파일 기반이라 그대로.
- `lib/resolve-audio.ts` — 손대지 않는다. 아래 참고.

---

## 4. 하지 말 것

- **레지스트리를 `lib/resolve-audio.ts`의 `local` / `youtube` 분기에 적용하지 말 것.** 소스가 둘뿐인 상태에서 도입하면 추상화만 늘고 얻는 게 없다. 세 번째 소스가 실제로 생길 때 꺼낸다.
- **innertube 엔진을 기본값으로 두지 말 것.** 옵션으로만 존재하고, 활성화 시 반드시 서버 프록시를 거치게 한다 (IP 바인딩).
- **`youtubei.js`를 필수 의존성으로 넣지 말 것.** `optionalDependencies`로, 엔진은 동적 `import()`.
- **하드코딩된 상수를 그대로 이식하지 말 것.** 동시 실행 2, 타임아웃 45초, 비트레이트 192k, stash 15초 — 전부 옵션 인자로.

---

## 5. 검증 체크리스트

MUXIC.js:

- [ ] `node --test` 통과 (resolver 순수 함수, 슬롯 획득/해제, 레지스트리 디스패치)
- [ ] 엔진은 목킹해서 테스트 — 실제 yt-dlp 호출하는 테스트는 만들지 않는다
- [ ] `abort()` 호출 시 두 프로세스 모두 종료되는지 (`ps`로 확인)
- [ ] 존재하지 않는 videoId → `ExtractionError` with 코드, 프로세스 잔류 없음

music.player 연동 후:

- [ ] 첫 재생: 몇 초 내 소리 남 (전체 트랜스코드 대기 아님)
- [ ] 같은 곡 재생 → tmp 캐시 히트, yt-dlp 재실행 없음 (로그 확인)
- [ ] 캐시된 곡 seek 동작 (206 응답)
- [ ] 트랙 3~4곡 연속 스킵 후 좀비 프로세스 0개
- [ ] 동시 3개 요청 → 3번째가 `TooManyExtractionsError` 한국어 메시지
- [ ] probe → 실제 요청 순서에서 yt-dlp가 한 번만 실행되는지