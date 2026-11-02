# Adavanced v0.5 실행본 갱신

이 저장소는 별도 비공개 고급 버전입니다. v0.4의 설치 없는 실행본·Python 계산 엔진 위에 v0.5의 모바일 화면과 체험 프로필·관심집을 추가했습니다. 이전 공개 저장소를 교체할 필요가 없습니다.

- 즉시 체험: 루트의 `play.html` 다운로드 후 브라우저로 열기.
- Replit·공식 자료 연동: `.replit`의 Python 서버 명령으로 실행.
- 소스 수정 후: `python3 build_static.py`로 `play.html`·`dist/index.html` 갱신.
- 검증: Python 테스트, Node가 있으면 JavaScript 문법·두 런타임 비교, `build_static.py --check`.

화면 변경은 `public/index.html`·`mobile.css`, 화면 이동과 기기 내 기록은 `mobile.js`, 계산 요청과 거래 카드는 `app.js`에서 수정합니다. 초기 자료 조회나 자금 입력 재계산만으로 화면이 이동하지 않도록 유지합니다. 생성된 `play.html`만 고치면 다음 빌드에서 변경이 사라집니다.

GitHub 소스 업로드와 비공개 앱 배포는 [검증 기록](VALIDATION.md)의 실제 완료 상태를 확인합니다. 기존 Replit 작업이 있다면 자신의 수정부터 보존하고 파일을 비교한 뒤 가져오세요.
