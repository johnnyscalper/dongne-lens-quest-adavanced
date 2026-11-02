# Adavanced 비공개 저장소

새 고급 버전은 **[johnnyscalper/dongne-lens-quest-adavanced](https://github.com/johnnyscalper/dongne-lens-quest-adavanced)**에서 별도로 관리합니다. 기존 공개 `dongne-lens-quest` 저장소를 덮어쓰지 않습니다.

| 항목 | 값 |
| --- | --- |
| 소유자 | `johnnyscalper` |
| 저장소 | `dongne-lens-quest-adavanced` |
| 앱 제목 | 동네렌즈 퀘스트 (Adavanced) |
| 공개 범위 | Private |
| 기본 브랜치 | `main` |
| 앱 버전 | `0.5.0` |

저장소 생성과 앱 소스 업로드는 별도 단계입니다. 실제 소스·CI 반영 상태는 [검증 기록](VALIDATION.md)에 적습니다.

## 가져오기

계정에 접근 권한이 있는 환경에서 다음 명령을 사용합니다. GitHub 인증은 브라우저나 승인된 자격 증명 도구로 진행하고 토큰을 명령·소스에 넣지 않습니다.

```bash
git clone https://github.com/johnnyscalper/dongne-lens-quest-adavanced.git
cd dongne-lens-quest-adavanced
python3 server.py --host 0.0.0.0 --port 3000
```

설치 없는 실행본은 루트의 `play.html`입니다. GitHub의 파일 보기 화면은 HTML 소스를 표시하므로 내려받아 브라우저로 열어야 합니다. 비공개 저장소에 파일을 올리는 것만으로 공개 웹사이트가 되지는 않습니다.

## 수정하기

기존 변경을 보존하고 최신 `main`에서 작업 브랜치를 만듭니다. `public/`의 화면이나 로컬 엔진을 고쳤다면 실행본을 다시 생성합니다.

```bash
git status --short
git switch main
git pull --ff-only origin main
git switch -c improve-app
python3 -m unittest discover -s tests -v
python3 build_static.py
python3 build_static.py --check
```

Node가 있다면 `npm run check:js`도 실행합니다. diff를 검토한 뒤 자신의 작업을 커밋하고 작업 브랜치/PR로 올립니다. 강제 푸시는 필요 없습니다. 실제 `.env`, 키, 개인 자료, 캐시와 가상환경을 올리지 않습니다.

`.replit`, `.github/workflows/ci.yml`, `.gitignore`, `.env.example`과 생성된 `play.html`을 포함해야 실행 구성이 함께 전달됩니다. `dist/`는 재생성할 수 있어 Git에서 제외합니다. `package.json`의 `private: true`는 npm 게시 방지용이며 GitHub 공개 범위와 별개입니다.

[Actions](https://github.com/johnnyscalper/dongne-lens-quest-adavanced/actions)에서 실제 원격 검사를 확인합니다. GitHub 저장소와 비공개 웹앱의 접근 권한은 각각 관리됩니다.
