# Position Sizing Calculator

Cloudflare Workers용 주식 포지션 사이징 계산기입니다.

## 기능

- 종목명 또는 심볼 검색
- KR, US, JP, HK, CN, VN 마켓 선택
- 한국 종목은 KRX 기준으로 조회
- KRX 기본 데이터는 Naver/KRX, 실패 시 Yahoo Finance 한국 종목 데이터로 자동 대체
- 해외 종목은 Yahoo Finance 차트 데이터 사용
- 일봉/주봉 선택
- 진입가와 손절가의 기준 거래일/거래주를 각각 최신/직전으로 선택
- RPT는 원화 기준으로 입력하고 선택 통화로 환산해 수량 계산
- 해외 통화 포지션 사이즈에는 원화 환산값도 함께 표시

## 원본 백업

Python/Render/NXT 버전 원본은 작업 전 별도 폴더에 백업했습니다.

```text
C:\Work\VSCode\Finance_backup_20260520_115519
```

## 로컬 실행

Node.js가 설치되어 있다면:

```powershell
npm install
npm run dev
```

Wrangler가 표시하는 로컬 주소로 접속하면 됩니다.

## Cloudflare Workers 배포

```powershell
npm install
npx wrangler login
npm run deploy
```

또는 Cloudflare Dashboard에서 GitHub 저장소를 연결해 Workers로 배포할 수 있습니다.

## 파일 구조

```text
worker.js          # API 서버: /api/search, /api/quote, /api/fx
wrangler.toml      # Cloudflare Workers 설정
public/index.html  # 화면
public/styles.css  # 스타일
public/app.js      # 브라우저 계산 로직
```

## 참고

NXT 실시간 조회와 한국투자 API 키는 Cloudflare Workers 버전에서 제거했습니다. 무료 서버리스 배포에 맞춰 KRX 기준 조회만 유지합니다.
