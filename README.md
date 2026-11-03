# 동네렌즈 퀘스트

**다음 집으로 가는, 나만의 궤도.**

서울 25개 구의 가상 거래를 살펴보고, 주소와 가격 조건에 따라 내 선택이 어떻게 달라지는지 체험하는 모바일 웹앱입니다.

## 공개 체험판

**[동네렌즈 퀘스트 열기](https://johnnyscalper.github.io/dongne-lens-quest-adavanced/)**

GitHub Pages에서 제공하는 **가상 데이터 체험판**입니다. API 키·로그인·Python 설치 없이 사용합니다.
단지명·금액·거래는 실제 시세나 현재 매물이 아닙니다. 투자 추천·심리 진단·정확한 선택 전환점을 제공하지 않습니다.
배포 상태와 실제 검수 범위는 [검증 기록](docs/VALIDATION.md)을 참고하세요.

### 심사자 체험 순서

1. **로그인 없이 둘러보기**로 진입합니다.
2. **지역 검색**에서 `마포구` 등을 검색하고 결과를 확인합니다.
3. 하단 **발견 → 주소 블라인드 선택실험**에서 조건만 보고 선택합니다.
4. 주소 공개 후 **선택 유지하기** 또는 **다시 선택하기**로 최종 선택을 마칩니다.
5. **가격이 달라지면 내 선택도 바뀔까?**를 누릅니다. 건너뛰기도 가능합니다.
6. 최종 선택 A와 비교할 B를 고르고, B의 가격을 0~30%까지 1%씩 낮춰봅니다.
7. **이 가격이면 B 선택 / A 유지 / 판단 어려움** 중 하나로 확정합니다.
8. 주소 공개 전·후·가정 가격 적용 후의 결과를 확인하고 문구를 복사하거나 다시 체험합니다.

슬라이더만 움직여서는 선택이 확정되지 않습니다. 원래 기준 가격·가정 가격·할인율·차액·면적·표본·출처를 구분합니다.
가격 가정은 원본 거래·관심집·자금계획을 바꾸지 않으며, 후보나 조회 조건 변경 시 이전 실험 결과를 초기화합니다.
복사가 지원되지 않으면 결과 텍스트를 직접 선택할 수 있습니다.

## 실행 방법

| 방식 | 실행 | 제공 범위 |
| --- | --- | --- |
| 공개 체험판 | 위 GitHub Pages 주소 | 가상 자료, 모바일 UI, 검색, 관심집, 두 실험, 자금 계산 |
| 설치 없이 파일 열기 | `play.html` 다운로드 후 브라우저로 열기 | 가상 자료 전용, 인터넷/Python 불필요 |
| Python / Replit | `python3 server.py --host 0.0.0.0 --port 3000` | 가상 자료 + 선택적 공식 자료 연결 |

Python 서버는 **Python 3.11+ 표준 라이브러리만** 사용합니다. pip/npm 패키지 설치가 필요 없습니다.
실행 후 `http://localhost:3000`을 엽니다. Windows는 `start.bat`, macOS/Linux는 `sh start.sh`도 사용할 수 있습니다.
Replit에서는 이 공개 저장소를 가져온 뒤 Run을 누릅니다. `.replit`의 Python 실행 구성을 유지합니다.
`npm start`는 Python 서버, `npm run dev`는 정적 실행본 생성·미리보기입니다.

## 정적 빌드와 GitHub Pages

```bash
python3 build_static.py
python3 build_static.py --check
```

빌더가 `play.html`과 `dist/index.html`을 동일하게 생성합니다. CSS·JavaScript·지역 목록을 HTML에 포함하며,
내부 탐색은 현재 경로와 해시를 유지하므로 `/dongne-lens-quest-adavanced/` 하위 경로에서도 동작합니다.
`public/index.html`이나 생성된 HTML을 직접 수정하지 말고 원본 소스를 수정한 뒤 빌드하세요.

저장소 **Settings → Pages → Build and deployment → Source: GitHub Actions**로 설정합니다.
`main` 변경 시 `.github/workflows/pages.yml`이 테스트·빌드 후 `dist/`만 공개 배포합니다.
Actions의 **Publish demo to GitHub Pages**에서 수동 실행할 수도 있습니다. 배포 결과는 해당 워크플로에서 확인합니다.
Python 소스나 API 키를 Pages에 배포하지 않습니다. Pages는 Python 서버를 실행하지 않습니다.

## 공식 자료 연결 (Python 서버 전용)

[매매 API](https://www.data.go.kr/data/15126469/openapi.do)와 [전월세 API](https://www.data.go.kr/data/15126474/openapi.do)
활용신청 후 서버 환경변수 `MOLIT_SERVICE_KEY`를 설정하고 서버를 다시 실행합니다.
Replit에서는 Secrets를 사용합니다. `.env`는 자동 로드하지 않으며 키를 소스나 정적 HTML에 넣지 않습니다.
공식 조회 실패를 가상 자료로 대체하지 않습니다. Pages 체험판에서는 공식 자료로 전환하지 않습니다.

## 데이터와 저장 범위

- 관심집은 조회 시점의 거래 집계이며 현재 매물이 아닙니다. 모드·지역·기간을 보존합니다.
- 닉네임·최근 검색·관심집만 해당 브라우저에 보관합니다. 실제 회원 인증이 아닙니다.
- 금융 입력과 블라인드/가격 실험 선택은 영구 저장하지 않습니다. 공유 URL에 금융 입력을 넣지 않습니다.
- 자금 입력은 만원, API·JSON 계산은 원입니다. 자금계획은 선택 단지가 아닌 지역 매매 중앙값 기준입니다.
- 적합도는 예산 60점 + 자기자금 40점의 가정식이며 매매 5건 미만이면 보류합니다.
- 가격 착시 실험은 단지·5㎡ 구간별 과거 거래 비교입니다. 동일 주택 가격지수나 상승 원인 판정이 아닙니다.
- Python과 브라우저의 가상 자료 생성기는 서로 다른 재현 가능한 값을 만들 수 있습니다.

## 개발 검증

```bash
python3 -m unittest discover -s tests -v
npm run check:js
python3 build_static.py
python3 build_static.py --check
```

Node가 있으면 브라우저 엔진 비교 검사도 실행합니다. 앱 자체 실행에는 Node가 필요하지 않습니다.
화면은 `public/index.html`, 기본/모바일 스타일은 `styles.css`·`mobile.css`,
블라인드 및 가격 실험은 `labs.js`·`labs.css`, Python API는 `server.py`에 있습니다.

[공개 저장소](https://github.com/johnnyscalper/dongne-lens-quest-adavanced) ·
[실행 안내](docs/REPLIT.md) · [계산과 자료 한계](docs/DATA_SOURCES.md) · [검증 기록](docs/VALIDATION.md)
