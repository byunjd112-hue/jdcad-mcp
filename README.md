# JDCAD MCP 서버

Claude가 언제든 JDCAD 엔진을 도구로 불러 KS 규격 기계·전기 도면을 만들고 AutoCAD 호환 DXF(R12)·SVG로 저장하게 해 주는 MCP 서버입니다.
외부 라이브러리 없이 Node.js 18 이상만 있으면 됩니다. 유료 라이선스 구성 요소는 없습니다.

## 도구
| 도구 | 하는 일 |
|---|---|
| jdcad_guide | KS 작도 규칙, 도면 사양 JSON 형식 |
| jdcad_standards | 볼트 구멍·탭·자리파기, 베어링, 끼워맞춤, 키, MCCB 정격 표 |
| jdcad_sample | 예제 사양 (bracket, panel) |
| jdcad_check | 자동 축척·용지와 규격·생산성 점검만 |
| jdcad_draw | DXF·SVG·JSON 저장, 이력·백업 기록 (원격 모드는 파일 본문 반환) |
| jdcad_history | 저장 이력, 마지막 저장 폴더, 백업 목록 |
| jdcad_restore | 자동 백업에서 사양 복원 |

저장 이력·마지막 폴더·백업은 `~/.jdcad/`에 남습니다 (환경변수 `JDCAD_HOME`으로 바꿀 수 있음). 같은 이름 파일을 덮어쓸 때는 `.bak`을 만듭니다.

## 연결 방법 1: Claude Desktop (Windows/Mac)
1. https://nodejs.org 에서 Node.js LTS 설치
2. 이 폴더를 예: `C:\JDCAD\jdcad-mcp` 에 둡니다.
3. Claude Desktop → 설정 → 개발자 → 구성 편집 → `claude_desktop_config.json`에 추가:
```json
{
  "mcpServers": {
    "jdcad": { "command": "node", "args": ["C:\\JDCAD\\jdcad-mcp\\server.js"] }
  }
}
```
4. Claude Desktop을 다시 시작하면 도구 목록에 jdcad가 보입니다.

## 연결 방법 2: Claude Code
```
claude mcp add --scope user jdcad -- node C:\JDCAD\jdcad-mcp\server.js
```

## 연결 방법 3: claude.ai 원격 커넥터 (웹·모바일 어디서나)
무료 호스팅 Render(https://render.com) 기준 순서입니다.
1. GitHub에 새 저장소(예: `jdcad-mcp`, 비공개 가능)를 만들고 이 폴더 파일을 올립니다.
2. Render 가입 → New → Blueprint → 그 저장소 선택. `render.yaml`대로 무료 웹 서비스가 생기고 비밀값 `JDCAD_SECRET`이 자동으로 만들어집니다.
3. Render 화면의 Environment에서 `JDCAD_SECRET` 값을 복사합니다. 서비스 주소가 `https://jdcad-mcp-xxxx.onrender.com`이면 커넥터 주소는
   `https://jdcad-mcp-xxxx.onrender.com/mcp/<JDCAD_SECRET 값>` 입니다. 이 주소는 비밀번호처럼 보관하세요.
4. claude.ai → 설정 → 커넥터 → 사용자 지정 커넥터 추가 → 위 주소 입력.

Docker 서버라면 `docker build -t jdcad-mcp . && docker run -e JDCAD_SECRET=비밀값 -p 8787:8787 jdcad-mcp`.
원격 모드에서는 파일을 서버에 쓰지 않고 DXF·SVG 본문을 응답으로 돌려줍니다 (이력·복원 도구는 로컬 전용). Render 무료 요금제는 한동안 안 쓰면 잠들어 첫 호출이 30초쯤 걸릴 수 있습니다.

## 사용 예
"jdcad로 100x60 두께 6 강판에 4-Ø9 구멍 플레이트 도면 만들어서 D:\도면\시험 폴더에 저장해줘"
→ Claude가 규칙 확인 → 사양 작성 → 점검 → 저장 폴더 확인 → DXF 저장. DWG는 AutoCAD에서 DXF를 열고 다른 이름으로 저장.
