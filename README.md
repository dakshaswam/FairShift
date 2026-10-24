# FairShift 급여명세서 추출 모듈

이미지/PDF에서 급여 정보를 꺼내는 독립 Python 모듈입니다. 기존 React 앱과 `server/`의 SerpApi 서비스는 그대로 둡니다. 임금법 위반 여부나 법적으로 받아야 할 임금을 판단하지 않습니다.

처리 순서는 **로컬 텍스트 추출 → 개인정보 가림 → 사용자 확인/수정/승인 → Gemini 구조화 추출 → Pydantic 검증 → Decimal 계산 점검 → 결과**입니다. 원본 이미지/PDF는 Gemini나 외부 OCR 서비스에 보내지 않습니다.

## 처음 설치하기

Python 3.12를 권장합니다. 프로젝트 루트(`paystub.py`가 있는 폴더)에서 실행하세요. 패키지와 spaCy 모델을 설치할 때만 다운로드가 필요하며, 문서를 읽는 동안 자동으로 모델을 다운로드하지 않습니다.

Windows PowerShell:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\HacTX"
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m spacy download en_core_web_lg
```

위 Python 경로는 현재 개발 PC에서 확인한 위치입니다. 다른 PC에서는 가상환경 생성 줄을 `py -3.12 -m venv .venv`로 바꿀 수 있습니다. 이후 명령은 가상환경을 별도로 활성화할 필요가 없습니다.

macOS / Linux:

```bash
cd /path/to/HacTX
python3.12 -m venv .venv
./.venv/bin/python -m pip install --upgrade pip
./.venv/bin/python -m pip install -r requirements-dev.txt
./.venv/bin/python -m spacy download en_core_web_lg
```

`en_core_web_lg`는 로컬 개인정보 탐지에 필요합니다. 모델이 없거나 Presidio가 실패하면 전송을 중단합니다. 설치 방식은 [Presidio 공식 문서](https://presidio.dataprivacystack.org/installation/)를 참고하세요.

사진과 스캔 PDF에는 Python 패키지 외에 **Tesseract 프로그램과 영어 언어 데이터**가 필요합니다. Windows에서는 다음 명령으로 설치하거나 [Tesseract 공식 설치 안내](https://tesseract-ocr.github.io/tessdoc/Installation.html)의 Windows 설치 링크를 이용하세요.

```powershell
winget install --id UB-Mannheim.TesseractOCR --exact
tesseract --version
```

설치 후 새 터미널에서도 `tesseract`를 못 찾으면 아래 `.env`에 `TESSERACT_CMD`를 지정하세요. macOS는 `brew install tesseract`, Ubuntu/Debian은 `sudo apt install tesseract-ocr tesseract-ocr-eng`를 실행합니다. 디지털 PDF는 `pdfplumber`, 스캔 페이지 렌더링은 `pypdfium2`가 담당하므로 Poppler 설치는 필요하지 않습니다.

사진 OCR은 작은 글자와 소수점 판독을 돕도록 이미지를 회색조로 바꾸고, 기존 픽셀 한도 안에서 최대 3배 확대해 이진화합니다. 이 과정은 메모리에서만 수행하며 중간 이미지 파일을 만들지 않습니다.

## API 키를 내 컴퓨터에 넣기

[Google AI Studio의 API 키 안내](https://ai.google.dev/gemini-api/docs/api-key)를 따라 키를 만든 뒤, 루트의 `.env.example`을 **처음 한 번만** `.env`로 복사하세요. 기존 `.env`가 있다면 덮어쓰지 말고 아래 설정만 추가하세요.

Windows:

```powershell
Copy-Item .env.example .env
notepad .env
```

macOS / Linux:

```bash
cp -n .env.example .env
```

VS Code 등으로 `.env`를 열어 다음 값을 수정하세요. 키를 채팅, Git, 스크린샷에 올리지 마세요.

```dotenv
GEMINI_API_KEY=발급받은_실제_키
GEMINI_MODEL=gemini-3.8-flash
# Windows에서 Tesseract를 찾지 못할 때만 사용:
# TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
# 선택: 설치된 OCR 언어 코드. 기본값은 eng입니다.
# TESSERACT_LANGUAGE=eng+spa
```

`gemini-3.8-flash`는 2026-10-24에 확인한 [공식 모델 목록](https://ai.google.dev/gemini-api/docs/models)의 안정 버전입니다. 계정/지역에 따라 사용 가능 여부가 다를 수 있으므로 `.env` 또는 `--model`로 변경할 수 있습니다. 명령행 도구는 루트 `.env`를 읽습니다. 모듈을 import하는 서버에서는 환경변수를 직접 설정하거나 `load_dotenv()`를 호출하세요.

## 가상 샘플 하나 실행하기

아래 PDF와 PNG는 같은 내용이며 이름, 주소, 계좌번호를 포함한 **모든 식별자가 가짜**입니다.

Windows:

```powershell
.\.venv\Scripts\python.exe paystub.py samples/sample_paystub.pdf
.\.venv\Scripts\python.exe paystub.py samples/sample_paystub.png --output result.json
```

macOS / Linux:

```bash
./.venv/bin/python paystub.py samples/sample_paystub.pdf
./.venv/bin/python paystub.py samples/sample_paystub.png --output result.json
```

화면에 **실제로 전송할 가림 처리된 텍스트 전체**가 먼저 나옵니다. 남은 개인정보가 없는지 확인한 뒤 `SEND`를 입력해야 전송합니다. 수정하려면 `EDIT`를 입력하고 전체 텍스트를 붙여넣은 뒤 `.END`로 끝내세요. 수정한 내용이 다시 표시되며, 다시 `SEND`를 입력해야 합니다. `CANCEL`은 취소입니다. 승인하지 않으면 API를 호출하지 않습니다. 수정 후에도 개인정보가 탐지되면 전송을 막습니다. 자동 승인 옵션은 제공하지 않습니다.

키 없이 로컬 가림 결과만 확인하려면 `.\.venv\Scripts\python.exe paystub.py samples/sample_paystub.pdf --preview-only`를 실행하세요(macOS/Linux: `./.venv/bin/python`). 이 옵션은 API 호출이나 결과 파일 저장을 하지 않습니다.

성공하면 JSON을 출력합니다. `--output`을 명시했을 때만 결과 JSON을 저장합니다. 기존 파일과 원본 입력을 덮어쓰지 않습니다. OCR 또는 가림 처리에 실패했을 때 원본 전송으로 우회하지 않습니다.

샘플의 주요 기대값은 정규근무 `80 × 18 = 1440`, 초과근무 `5 × 27 = 135`, 팁 `40`, 총급여 `1615`, 공제 합계 `273.42`, 실수령액 `1341.58`입니다. 연간 누적액(YTD)은 현재 기간 값에 넣지 않습니다. [전체 기대 JSON](samples/expected_paystub.json)은 사람이 작성한 테스트 기준이며 실제 Gemini 응답이 아닙니다. 실제 모델의 경고 문구는 달라질 수 있습니다.

## 팀원이 가져다 쓰기

```python
from dotenv import load_dotenv
from fairshift_paystub import extract_paystub

load_dotenv(".env")

def approve_in_terminal(redacted_text: str) -> str | None:
    from fairshift_paystub.cli import terminal_review
    return terminal_review(redacted_text)  # 미리보기, 수정, 명시적 승인 지원.

result = extract_paystub(
    "samples/sample_paystub.pdf",
    review=approve_in_terminal,
)
print(result.model_dump_json(indent=2))
```

`review` 콜백에는 가려진 텍스트만 전달됩니다. 미래 UI에서는 미리보기와 수정창을 표시하고 **사용자의 명시적인 승인 후에만** 수정된 문자열을 반환하세요. 취소는 `None`입니다. 콜백을 무조건 문자열을 돌려주는 함수로 만들면 사용자 승인 요건을 지킬 수 없습니다. 서로 다른 사용자의 승인 텍스트나 결과를 공유하면 안 됩니다.

비동기 UI에서는 `prepare_paystub(file_path)`로 로컬 미리보기를 만든 뒤, 해당 사용자가 수정·승인한 정확한 문자열을 `complete_paystub(approved_text, approved=True)`에 전달할 수 있습니다. 백엔드는 미리보기와 동의를 동일한 사용자에게 연결해야 합니다. 이 모듈은 로그인이나 사용자 세션을 관리하지 않습니다.

반환값은 Pydantic `Paystub` 객체입니다. `model_dump(mode="json")`은 JSON으로 바꿀 수 있는 dict, `model_dump_json()`은 JSON 문자열을 반환합니다. 원래 필드인 사업체명, 기간/지급일, 통화, 근무시간/단가/급여, 팁, 총급여, `deductions`, 실수령액, `other_earnings`, `warnings`를 유지합니다. 공제는 `{label, amount}`, 추가/복수 단가 수입은 `{label, amount, hours, hourly_rate}` 형태입니다. 원래 라벨에 개인정보가 있으면 가린 상태를 유지합니다.

금액과 시간은 내부에서 `Decimal`이며 JSON에서는 `"1615.00"`처럼 문자열입니다. 모르는 값은 `null`이고 누락된 팁/초과근무를 `0`으로 만들지 않습니다. 여러 단가가 있으면 하나로 합치지 않고 항목별로 보존합니다. SSN, 주소, 계좌번호 등은 반환 스키마에 없습니다. 원래 개인정보를 다시 끼워 넣지 않습니다.

Gemini에 보내는 스키마도 Decimal 필드를 문자열 또는 `null`로 요청합니다. 모델 요청이 너무 복잡해지지 않도록 전송용 스키마의 길이·배열 크기 제한은 생략하고, 응답을 받은 뒤 로컬 Pydantic 검증에서 모두 적용합니다. 음수 시간, 비정상 숫자, 과도한 길이 등을 허용하도록 로컬 검증을 완화한 것은 아닙니다.

## 검증과 테스트

Windows:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

macOS / Linux:

```bash
./.venv/bin/python -m pytest -q
```

자동 테스트는 가상 문서와 **모의 Gemini 응답**을 사용하며 실제 API를 호출하지 않습니다. 요청에 `[NAME_1]`, `[ACCOUNT_1]` 같은 가림 표시가 있고 알려진 가짜 식별자는 없는지, OCR/가림 실패와 승인 거부가 전송을 차단하는지, 임시 파일과 원본 처리, 출력 스키마 및 계산을 확인합니다. 모의 응답 테스트가 통과해도 실제 Gemini 추출 품질을 증명하지 않습니다. Tesseract 실행 파일과 spaCy 모델이 없는 환경에서는 실제 OCR/탐지 통합 확인을 별도로 해야 합니다.

2026-10-24 개발 환경 검증 결과: **197개 자동 테스트 통과**. 현재 합성 PNG에서 실제 로컬 Tesseract OCR과 개인정보 가림을 실행해 급여 숫자를 확인했습니다. 브라우저 회귀 테스트는 API를 모의 처리하며, 모의 결과를 실제 Gemini 결과와 구분해 표시하는지 확인합니다. 별도의 실제 Gemini 호출은 각 요청 결과에 표시되며, 모의 테스트 결과와 혼동하지 마세요.

이 환경에서는 Tesseract를 설치해 실제 사진 OCR을 확인했습니다. 다른 환경에서 OCR 실행 파일이나 spaCy 모델이 없으면 해당 로컬 단계를 통과하지 못하며, 이때 외부 OCR이나 샘플 응답으로 대체하지 않습니다.

계산 점검은 빠진 공제나 금액을 만들어 맞추지 않습니다. 현재 기간 공제 총액, 항목별 금액, 단순한 급여 구조가 확인된 경우에만 총급여-공제=실수령액을 비교하고, 조건이 부족하면 건너뛰었다는 경고를 냅니다. 불일치는 **재검토 표시**이며 미지급 임금이나 법 위반의 증거가 아닙니다. 결과에는 사용자 검토가 필요하다는 경고가 항상 남습니다.

## 개인정보 처리 범위와 한계

여기서 **로컬은 Python 모듈이 실행되는 컴퓨터**입니다. 지금 PC에서 실행하면 PC에서 원본을 읽습니다. 나중에 서버로 옮기면 서버가 원본을 받게 됩니다. 원본이 사용자의 기기를 떠나지 않게 하려면 OCR/가림 처리와 승인 화면을 사용자 기기에서 실행하도록 구조를 바꿔야 합니다.

Presidio와 급여명세서 전용 정규식/문맥 규칙을 함께 사용해 이름, 전체/부분 SSN, 직원 ID, 개인 주소, 이메일, 전화, 계좌/라우팅 번호를 가립니다. 날짜, 시간, 단가와 금액은 남깁니다. 일반 탐지기만 믿지 않지만, **영문 중심 규칙, OCR 오독, 생소한 양식/언어, 라벨 없는 식별자 때문에 누락이나 과잉 가림이 생길 수 있습니다.** 그래서 전송 전 직접 확인과 수정이 필요합니다.

앱은 원본 복사, 원문 OCR 텍스트, 가림표시-원본 대응표를 저장하지 않습니다. PDF 렌더링과 Tesseract 입출력은 메모리/파이프를 사용해 민감한 임시 파일 자체를 만들지 않습니다. 사용자의 원본 파일은 삭제하지 않습니다. Gemini 통신 진단 로그에는 실제 UTF-8 JSON 요청 본문의 처음 200자와 실패한 경우 제공자 오류 응답 본문을 기록합니다. 이 로그 조각은 승인된 문서의 가림 처리 실수를 포함할 수 있으므로 접근을 제한하고 보관 정책을 적용하세요. API 키는 요청 헤더로만 보내며 진단 로그에 기록하지 않습니다. 결과 파일은 `--output`을 지정할 때만 만들며, 대화 기록이나 사용자 간 요청 문맥은 보관하지 않습니다. Python 메모리의 완전한 덮어쓰기, 운영체제 스왑/덤프, 터미널 기록, 서버 운영자의 외부 로깅까지 보장하는 것은 아닙니다.

Gemini에는 승인된 텍스트만 한 번의 독립 요청으로 보냅니다. 도구, 검색, grounding, 외부 검색 자료, 파일 업로드, 명시적 context cache를 사용하지 않습니다. 문서 속 명령문은 신뢰하지 않는 데이터로 취급합니다. 응답은 스키마 검증 후 문자열도 개인정보 탐지로 점검합니다. **Pydantic은 형식을 확인할 뿐 추출 정확성이나 모든 프롬프트 인젝션 방지를 보장하지 않습니다.** 부정확한 숫자/누락/잘못된 해석은 사람이 원본과 대조해야 합니다.

## Gemini 제공자 데이터 사용 설정

다음은 **2026-10-24에 확인한 Gemini Developer API 공식 문서** 기준입니다. 앱이 파일을 저장하지 않는다는 사실은 Google도 데이터를 전혀 보관하지 않는다는 뜻이 아닙니다.

- 무료 서비스에서는 입력/응답이 제품 개선에 사용되거나 사람이 검토할 수 있으며, Google은 민감한 개인정보를 보내지 말라고 명시합니다. 활성 Cloud Billing 계정과 연결된 프로젝트를 통한 유료 API 서비스에는 제품 개선 사용 제한이 적용됩니다. 지역별 예외도 있으므로 [API 추가 약관](https://ai.google.dev/gemini-api/terms)을 확인하세요.
- 유료 서비스도 악용 방지용 보관이 있습니다. 현재 [악용 감시 문서](https://ai.google.dev/gemini-api/docs/usage-policies)는 프롬프트·문맥·출력을 **55일** 보관한다고 설명합니다. 전송 전 남은 개인정보를 확인해야 하는 이유입니다.
- AI Studio의 **Logs and Datasets → Settings**에서 이 프로젝트의 요청 로그 저장을 끄고, 실제 문서를 dataset에 저장하거나 Google에 공유하는 선택을 하지 마세요. `generateContent`는 기본 저장을 하지 않지만 프로젝트 설정으로 켤 수 있습니다. 모듈도 요청마다 `store=False`를 명시하며, 이 설정을 지원하지 않는 오래된 SDK는 전송 전에 거부합니다. 개발자 로그 설정과 악용 감시 보관은 별개입니다. [로그와 데이터셋 공식 문서](https://ai.google.dev/gemini-api/docs/logs-datasets)
- 명시적 캐시를 만들지 않아도 모델에는 기본적인 암묵적 메모리 캐시가 있을 수 있습니다. 공식 설명은 프로젝트별 격리, RAM 저장, 24시간 TTL입니다. 이 모듈은 제공자 측 캐시와 보관을 통제하거나 절대적인 zero retention을 보장하지 않습니다. 보장된 ZDR가 필요하다면 별도 서비스/설정 검토가 필요하다고 Google은 안내합니다. [ZDR 공식 문서](https://ai.google.dev/gemini-api/docs/zdr), [캐시 공식 문서](https://ai.google.dev/gemini-api/docs/caching)

## 추가된 파일

- `paystub.py`: 명령행 진입점.
- `fairshift_paystub/`: 로컬 추출, 가림 처리, Gemini 요청, 스키마 검증, 계산 점검, 재사용 함수.
- `tests/`: 개인정보 경계와 실패 경로를 포함한 모의 테스트.
- `samples/`: 가상 원문, 디지털 PDF, OCR용 PNG, 기대 JSON, 로컬 재생성 스크립트.
- `requirements*.txt`, `.env.example`, `.gitignore`: 설치와 로컬 설정/민감 파일 제외.

샘플을 다시 만들려면 `python samples/generate_samples.py`를 가상환경의 Python으로 실행하세요. 실제 급여명세서와 결과는 Git에 올리지 말고 `.gitignore`에 지정된 로컬 입력/출력 폴더에 두세요.
