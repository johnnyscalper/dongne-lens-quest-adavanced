# API와 화면 이벤트

서버와 브라우저는 같은 출처를 사용한다. 모든 금액은 원, 날짜는 ISO 형식이다. JSON 요청은 최대 3MB·거래 5,000건으로 제한한다. 잘못된 입력은 오류를 반환하며 값으로 대체하지 않는다.

| API | 용도 |
| --- | --- |
| `GET /health` | 상태·앱 버전 |
| `GET /api/config` | 공식 키 설정 여부·자료 라벨 |
| `GET /api/regions?q=청담` | 지원 지역 검색 |
| `GET /api/market?region=11680&months=6&mode=demo` | 지역·기간별 가상/공식 거래 |
| `POST /api/analyze` | 거래 집계·자금 계산 |
| `POST /api/insights` | 가격 착시 비교·블라인드 후보 |
| `GET /api/insights/example` | 별도 가상 착시 연습 예제 |

`mode`는 `demo` 또는 `live`, `months`는 3·6·12다. 키 없는 공식 요청은 오류를 반환한다. `market` 응답의 `coverage`, `warnings`, `mode`, `source`, `period`를 화면에서 유지한다.

## 두 실험 요청

```json
{
  "records": [],
  "area_band": "all",
  "neighborhood": "",
  "period": {"start": "2026-06-01", "end": "2026-11-02"}
}
```

`records`에는 `/api/market`의 표준 거래 배열을 전달한다. `area_band`는 `all`, `small`, `medium`, `large`다. 날짜 예시는 스키마 설명이며 호출 시 조회 응답의 기간을 그대로 사용한다.

응답의 `mix`에는 `status`, 앞/뒤 기간 요약, `raw_change_pct`, `matched_change_pct`, `matched_cohorts`, `coverage_pct`, 매칭 그룹, 계산식과 한계가 담긴다. `blind`에는 `status`, 후보 목록, 후보 수와 한계가 담긴다. 표본 부족은 `insufficient`와 빈 후보 또는 null 지표로 표현한다. 연습 예제의 `mix.is_example`은 true다.

실제 필드와 계산의 기준은 `insights.py`와 테스트다. `mix_gap_pp`는 두 결과의 차이이며 인과적 구성 효과가 아니다.

## 브라우저 이벤트

| 이벤트 | detail | 동작 |
| --- | --- | --- |
| `lens:analysis` | `market`, `analysis`, `filters`, `assumptions` | 실험 계산 요청과 새 결과 표시 |
| `lens:clear` | `reason` | 대기 요청 취소·이전 실험과 선택 초기화 |
| `lens:destination` | `name`, `mode` | 3D 마을 목적지 갱신 |
| `lens:ready` | `regions`, `config` | 모바일 검색 목록·연결 상태 준비 |
| `lens:busy` | `loading`, `analyzing` | 실제 요청 중 상태 표시 |
| `lens:search-success` | `query`, `region`, `neighborhood`, `market`, `analysis` | 명시적인 검색이 성공했을 때만 검색 패널 닫기·거래 화면 이동 |
| `lens:search-error` | `message` | 검색 패널에서 오류 표시, 실패한 검색의 이전 결과 제거 |
| `lens:apartment`, `lens:save` | `key`, `apartment`, `region`, `mode`, `period` | 단지 상세 열기 또는 관심집 저장·해제 |
| `lens:saved-changed` | `keys` | 거래 카드의 관심 상태 동기화 |
| `lens:screen-change` | 현재 화면 정보 | 3D 장면의 활성 화면·렌더링 상태 갱신 |

`labs.js`는 요청 순번과 AbortController로 이전 응답이 새 조건을 덮지 않게 한다. 금융 입력과 선택 이력은 서버 저장이나 외부 추적에 보내지 않는다.

`DongneApp.search(query, {navigate: true})`는 지역 해석·조회·분석을 거친 명시적 검색 진입점이다. `getSnapshot()`은 현재 화면 계산 상태를 읽고 `notify()`는 상태 메시지를 표시한다. `mobile.js`는 이 인터페이스와 이벤트를 사용하며 별도 API 요청을 만들지 않는다.

초기 자동 조회·필터 변경·자금 재계산의 `lens:analysis`만으로 화면을 전환하지 않는다. 오래된 요청의 응답은 화면 이동이나 관심집 자료를 덮어쓰지 않는다. 새로 추가한 프로필·최근 검색·관심집의 브라우저 저장 범위는 [모바일 안내](MOBILE.md)를 따른다.

## 설치 없는 실행의 로컬 API

단일 HTML은 `DONGNE_RUNTIME === 'local'`일 때만 `DongneLocal.request(url, options)`에 요청을 전달한다. 반환값은 Response 객체가 아닌 파싱된 JSON Promise이며 `options.signal`과 JSON `body`를 처리한다. 위의 응답 구조를 유지하되 공식 `live` 요청은 명시적으로 거절한다. 오류가 발생해도 서버나 다른 모드로 자동 전환하지 않는다.

로컬 config는 `local_only: true`, `live_available: false`, `app_version: '0.5.0'`이다. `DongneAnalytics.analyze`와 `DongneInsights.build`는 같은 거래 입력에 대해 Python 결과와 비교된다. 스타일은 문서 머리에서 인라인으로, 지역 목록과 모든 JavaScript는 본문 끝에서 인라인으로 포함하므로 별도 자산이나 네트워크 호출이 필요 없다.
