# 실행과 배포 안내

## 공개 가상 데이터 체험판

[동네렌즈 퀘스트](https://johnnyscalper.github.io/dongne-lens-quest-adavanced/)는 GitHub Pages에서 실행합니다.
로그인·API 키 없이 게스트 진입 → 지역 검색 → 결과 → 하단 발견 → 블라인드 선택 → 내 선택의 가격을 체험합니다.
가상 단지·금액은 실제 시세나 매물이 아닙니다.

## Python / Replit

현재 [공개 저장소](https://github.com/johnnyscalper/dongne-lens-quest-adavanced)를 내려받거나 Replit으로 가져옵니다.
Python 3.11 이상에서 다음 명령을 실행합니다. 별도 패키지 설치는 없습니다.

```bash
python3 server.py --host 0.0.0.0 --port 3000
```

`http://localhost:3000`을 열거나 Replit Preview를 사용합니다.
Replit의 Run은 `.replit`의 같은 명령을 사용합니다. `server.py`, `public/`, `data/`를 함께 유지하세요.
Windows는 `start.bat`, macOS/Linux는 `sh start.sh`도 지원합니다.
공식 API는 서버 환경변수 `MOLIT_SERVICE_KEY`가 필요합니다. `.env` 자동 로드는 없으며 정적 파일에 키를 넣지 않습니다.

## 정적 실행 및 Pages

```bash
python3 build_static.py
python3 build_static.py --check
python3 build_static.py --serve --host 0.0.0.0 --port 3001
```

`play.html`을 로컬에서 직접 열거나 위 명령의 `http://localhost:3001`에서 확인합니다.
`dist/index.html`에는 스타일·코드·지역 자료가 모두 포함되며 외부 API 요청 없이 가상 자료로 동작합니다.
현재 경로를 유지하는 해시 탐색으로 GitHub Pages 저장소 하위 경로를 지원합니다.

GitHub Settings → Pages → Source를 **GitHub Actions**로 설정합니다.
`main` 변경 시 **Publish demo to GitHub Pages** 워크플로가 테스트·정적 빌드 후 `dist/`를 배포합니다.
Actions의 워크플로 화면에서 Run workflow를 눌러 `main`을 수동 배포할 수도 있습니다.
환경 승인이 요구되면 보호 규칙에 따라 승인해야 하며 이를 우회하지 않습니다.

Pages는 Python을 실행하지 않으므로 공식 실거래 연결은 Python/Replit 실행 버전을 사용하세요.
검증한 범위는 [검증 기록](VALIDATION.md)에 기록합니다.
