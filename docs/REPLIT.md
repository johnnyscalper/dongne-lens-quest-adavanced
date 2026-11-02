# Replit과 로컬 실행

세 가지 실행 방식은 같은 모바일 화면을 사용합니다. 설치 없는 버전은 가상 자료 전용이고, 공식 자료 연결은 Python 서버에서 제공합니다. 실제 회원 인증 없이 체험 프로필 또는 게스트로 시작합니다.

## Replit 서버 앱

1. [비공개 저장소](https://github.com/johnnyscalper/dongne-lens-quest-adavanced)에 접근할 수 있는 GitHub 계정으로 저장소를 가져옵니다.
2. 루트에 `server.py`, `public/`, `data/`, `.replit`이 있는지 확인합니다. 압축을 사용했다면 중첩 폴더 안에 실행 파일이 남지 않게 합니다.
3. 아래 실행 명령을 확인하고 Run을 누릅니다.

```bash
python3 server.py --host 0.0.0.0 --port 3000
```

`.replit`은 Python 3.11, 내부 포트 3000, 외부 포트 80을 지정합니다. pip/npm 패키지 설치나 프런트엔드 빌드 없이 가상 체험을 실행합니다. `/health` 응답의 `version`은 `0.5.0`입니다.

처음에는 체험 시작 화면이 나타납니다. 닉네임 또는 게스트로 들어가 지역을 검색하면 가상 거래 화면으로 이동합니다. 공식 자료가 필요하면 매매·전월세 API 활용신청 후 Replit Secrets에 `MOLIT_SERVICE_KEY`를 넣고 서버를 재시작합니다. `.env`는 자동 로드하지 않습니다. 게시 환경에서도 서버 환경변수 설정과 외부 API 응답을 따로 확인해야 합니다.

비공개 GitHub 저장소를 가져오려면 Replit의 GitHub 연결이 해당 저장소에 접근할 수 있어야 합니다. GitHub의 Private 설정은 Replit 앱의 공개 범위를 정하지 않으므로 앱을 게시할 때 대상 범위를 따로 확인합니다.

Replit에서 준비된 실행 명령을 사용하는 구성입니다. 실제 Replit 계정에서의 가져오기·게시 성공을 대신 주장하지 않으며 확인 결과는 [검증 기록](VALIDATION.md)에 구분합니다.

## 휴대폰에서 사용

휴대폰 브라우저로 비공개 웹앱이나 실행 중인 Replit 앱의 접근 가능한 주소를 엽니다. 홈·탐색·실험·관심·내정보 하단 탭과 검색·상세 패널을 사용합니다. `play.html`의 로컬 파일 실행 방식은 휴대폰 브라우저·파일 앱에 따라 다를 수 있어 휴대폰에는 웹 주소를 권합니다. 자세한 동선과 저장 범위는 [모바일 안내](MOBILE.md)를 참고하세요.

## 내 컴퓨터에서 서버 실행

Python 3.11 이상이 있다면 Windows의 `start.bat` 또는 macOS/Linux의 `sh start.sh`를 사용합니다. 실행 후 [http://localhost:3000](http://localhost:3000)을 엽니다. 터미널을 닫으면 서버도 멈춥니다. 다른 포트가 필요하면 직접 `--port 3001`처럼 지정합니다.

## Python 없이 바로 체험

`play.html`을 다운로드해 브라우저로 엽니다. 필요한 화면·코드·지역 목록을 한 파일에 포함하므로 서버나 인터넷 연결이 없어도 체험할 수 있습니다. 파일의 URL은 공유할 수 없으며 분석 결과는 JSON으로 저장할 수 있습니다.

[비공개 웹앱](https://dongne-lens-adavanced-johnny.johnjeongv12.chatgpt.site)도 같은 설치 없는 버전입니다. 실제 게시 확인은 [검증 기록](VALIDATION.md)을 따릅니다. 소유자만 접근하는 웹앱이며 공식 키를 받지 않습니다.

## 수정 후 실행본 갱신

```bash
python3 build_static.py
python3 build_static.py --check
```

빌더는 `play.html`과 `dist/index.html`을 동일하게 생성합니다. `public/index.html`을 직접 파일로 열면 서버 API가 없으므로 대신 `play.html`을 사용합니다. `npm run dev`는 정적 체험 미리보기, `npm start`는 Python API 서버입니다. `.replit`의 Run은 Python API 서버로 유지합니다.

Python·브라우저의 가상 생성기는 서로 다르므로 예시 금액이 다를 수 있습니다. 같은 거래 배열에 대한 계산·실험 결과는 비교 테스트로 관리합니다.

## 문제를 확인할 때

- 서버 시작 오류: Python 버전, 현재 폴더, 사용 중인 포트를 확인합니다.
- 공식 자료 모드 비활성: 서버 키 설정과 서버 재시작 여부를 확인합니다.
- 설치 없는 파일에서 공식 자료 필요: Python 서버로 실행합니다.
- 화면 소스 수정이 play.html에 반영되지 않음: 빌더를 다시 실행합니다.
- GitHub에 보이는 HTML 코드만 나타남: 파일을 내려받아 열거나 비공개 웹앱을 사용합니다.
