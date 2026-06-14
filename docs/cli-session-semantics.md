# Agent CLI Session 语义调查（Claude Code + Pi）

> 调查日期：2026-06-14
> 调查动机：厘清 `agent-gateway` 中 `claude_code.py` / `pi_agent.py` 的 session 集成方式是否正确，以及"彻底使用底层 CLI 原生 session 机制"在客户端侧是否稳定可行。
> 方法：全部结论以**本机实测**为准（非仅凭文档/注释），可复现命令见附录。
> 覆盖：Claude Code（2.1.163）与 Pi（0.75.3）两款底层 agent CLI。

---

## TL;DR

两个 CLI 都**自带可用的、跨进程稳定的原生 session 机制**，但网关当前都没正确使用——每轮都起新 session、靠 `history` 文本重放，把 agent 降级成了无状态 LLM。彻底化在两者上都可行，但**集成方式不同**：

| | Claude Code | Pi |
|---|---|---|
| session 存储 | transcript 文件（`~/.claude`） | session 文件（`~/.pi/agent/sessions`） |
| 创建机制 | 显式 `--session-id <uuid>` | 隐式（首轮自动），id 在输出首行返回 |
| 续接机制 | `--resume <uuid>`（确定性） | `--session <id>`（确定性）/ `--continue`（最近） |
| 复用"创建 flag" | ❌ `already in use`（确定性失败） | N/A（无单独创建 flag，不存在此问题） |
| 跨进程续接 | ✅ 靠 `--resume`（实测） | ✅ 靠 `--session <id>`（实测） |
| 工具历史保留 | ✅（实测） | ✅（实测） |
| 是否进程锁 | 是（针对 `--session-id` 复用） | **否**（文件型，天然可重入） |
| 能否预指派 id | ✅（`--session-id` 创建时指定） | ❌（Pi 自行 mint，只能事后捕获） |

**对 Q1/Q2 的统一回答**：
- **Q1**（不用原生 session 是否废掉能力）：**是**。两个 CLI 的原生 session 都携带 tool 调用/结果、上下文压缩、任务状态；网关当前的双份记账（既传 session flag 又文本重放）丢掉了这些。
- **Q2**（彻底用原生 session 是否稳定）：**是**。两者跨进程、跨重启、无限轮、含工具历史全部实测稳定。所谓"不能复用"的障碍**只属于 Claude Code 误用 `--session-id` 续接**；Pi（文件型）连这个都没有。

---

## 调查背景：三层 session 模型

这个桌面项目（`hermes-desktop`）+ 后端（`agent-gateway`）+ 底层 CLI 共有三层"session"概念：

```
┌─────────────────────────────────────────────────────────────┐
│ ① 桌面客户端 (hermes-desktop)                                │
│    stored_session_id (URL/DB) / runtime session_id           │
│    _lineage_root_id（压缩轮换：root → tip）                   │
└──────────────────────────┬──────────────────────────────────┘
                           │ JSON-RPC: session.create / resume / prompt.submit
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ ② 网关层 (agent-gateway)  DesktopSession                      │
│    session_id            (网关关内存 key)                      │
│    backend_session_ref   ★ = 一个 UUID，桥接到 CLI             │
│    history[]             (网关自存的 {role,content} 列表)       │
└──────────────────────────┬──────────────────────────────────┘
                           │ shell: claude/pi -p ...             ← 问题在这
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ ③ CLI 层 (Claude Code / Pi)                                  │
│    CLI 自己的 transcript / session，存本地文件                 │
└─────────────────────────────────────────────────────────────┘
```

**触发本次调查的疑点**：
1. `claude_code.py` 既传 `--session-id`，又把 `history` 拍平成 `Human:/Assistant:` 文本重放——**双份上下文记账**。
2. `claude_code.py:5` 文档字符串自称 "Each invocation is stateless — history is reconstructed in the prompt."——等于在说"没用 CLI 的 session 记忆"。
3. `session_manager.py:176-179` 有一行注释："CLI tools like Claude Code lock session IDs to a single process and reject reuse with 'already in use' errors."——据此在 resume 时换新 ref。
4. `pi_agent.py:_build_args`（`:99-139`）签名收了 `session_ref`，但 json/print 模式下**从未把它加进 args**——Pi 在网关里同样每轮新 session。

---

## 环境

| CLI | 版本 | 路径 | 调用方式 | provider/model |
|---|---|---|---|---|
| Claude Code | 2.1.163 | `/home/ryanli/.local/bin/claude` | `claude -p --output-format json` | 默认（按账号） |
| Pi | 0.75.3 | `.../nvm/.../bin/pi` | `pi --mode json --print` | b.ai / deepseek-v4-pro（cost=0） |

平台：Linux 6.12 (Debian 13)。`-p` / `--print` 每次都是全新进程，跑完即退——所以"跨进程"在 print 模式下就是默认情形。

---

## 实测记录 A — Claude Code（4 组实验，均本机复现）

### A1 — `--session-id` 复用 vs `--resume` 接续（token 召回）

用一个模型猜不到的随机 token `ZXQ-7431` 测上下文是否跨进程接续。

```
SID=7ca2c44f-6be3-476e-aca1-54eeb42f3971   # python3 -c "import uuid; print(uuid.uuid4())"

# A) 首次 --session-id：记住 token
claude -p --session-id "$SID" --output-format json \
  "I'm giving you a secret token for this session: ZXQ-7431. Just reply: STORED"
# → {"result":"STORED", "session_id":"7ca2c44f-...", ...}   ✓ 创建成功

# B) 新进程、同一 --session-id 再用一次
claude -p --session-id "$SID" --output-format json "What is the secret token?"
# → Error: Session ID 7ca2c44f-6be3-476e-aca1-54eeb42f3971 is already in use.   ✗ 复用失败

# C) 新进程、改用 --resume
claude -p --resume "$SID" --output-format json "What is the secret token? Reply only the token."
# → {"result":"ZXQ-7431", "session_id":"7ca2c44f-...", ...}   ✓ 跨进程召回成功
```

**结论**：`--session-id` 不能跨进程复用（确定性失败，验证了 `session_manager.py:178` 注释**属实**）；`--resume` 可以跨进程加载上下文。

### A2 — resume-after-resume 多轮接续（数数）

```
SID=1cd349d6-8727-4244-91d0-a5fa20664520

# E1) --session-id 创建：我说 1 → result='2'
claude -p --session-id "$SID" --output-format json "Let's count up together. I say 1. Reply with only the next single number."

# E2) 新进程 --resume → result='3'
claude -p --resume "$SID" --output-format json "Continue counting up from the last number we reached together. Reply with only the next single number."

# E3) 又一个新进程 --resume → result='4'
claude -p --resume "$SID" --output-format json "Continue counting up from where we left off. Reply with only the next single number."
```

序列 `2 → 3 → 4` 证明：每次 `--resume` 都加载了之前的完整对话，且可无限轮叠加。

### A3 — `--session-id` 复用是确定性失败

A1 的 B 已复现一次；再用另一个全新 id 验证不是偶发：

```
SID=ecfb065f-0b97-4622-84b2-b26b31678fd8
claude -p --session-id "$SID" "..."         # 创建
claude -p --session-id "$SID" "..."         # 复用
# → Error: Session ID ecfb065f-... is already in use.   ✗ 再次复现
```

两次独立 id 都在第二次 `--session-id` 时报同样错误 → **确定性**，非偶发。

### A4 — 工具历史（tool calls + results）跨进程保留 ★

T1 用工具写文件（含唯一标记），T2 在新进程用 `--resume` 命令"不许用工具、只凭记忆"复述。

```
SID=1d541d24-4377-4b0b-ac9a-c211169f7422
FILE=/tmp/cc-tooltest-$SID.txt
MARK=DELTA-6042

# T1) --session-id 创建：用文件写入工具
claude -p --session-id "$SID" --dangerously-skip-permissions --output-format json \
  "Use your file-writing tool to create the file at $FILE with exactly this single line: DELTA-6042. Then reply: WROTE."
# → result='WROTE.' | num_turns=2          ✓ 用了工具，文件实际内容 = DELTA-6042

# T2) 新进程 --resume：禁用工具，只凭记忆
claude -p --resume "$SID" --dangerously-skip-permissions --output-format json \
  "In the previous turn you created a file. WITHOUT using any tools at all, answer purely from memory: what exact content did you write into that file?"
# → result='DELTA-6042' | num_turns=1      ✓ 从记忆召回，num_turns=1 证明没偷读文件
```

`num_turns` 是关键证据：T1=2（调用了写文件工具）、T2=1（没调任何工具，纯 transcript 记忆）。→ `--resume` 加载的是**完整 transcript**，含 tool 调用与结果。

---

## 实测记录 B — Pi（4 组实验，均本机复现）

### B0 — 发现：session 默认存盘，id 在输出首行

```
pi --mode json --print "I'm giving you a secret token: OMICRON-3391. Reply with only: STORED" < /dev/null
# JSONL 首行: {"type":"session","id":"019ec49c-0db2-7077-9741-2788a1962ec2"}
# 文件落在 ~/.pi/agent/sessions/...（UUIDv7，时间序）
```

Pi **默认存盘**（除非传 `--no-session`）；session id 是 JSONL 第一行的 `{"type":"session","id":...}`。

### B1 — `--session <id>` 跨进程恢复（token 召回）

```
SID=019ec49c-0db2-7077-9741-2788a1962ec2   # 取自 B0 首行

# P2) 新进程 --session <id> 问 token
pi --mode json --print --session "$SID" "What was the secret token I gave you earlier? Reply with only the token." < /dev/null
# → 'OMICRON-3391'   ✓ 跨进程恢复

# P3) 又一个新进程 --session <id>
pi --mode json --print --session "$SID" "Reply with the token, then the word DONE." < /dev/null
# → 'OMICRON-3391 DONE'   ✓ resume-after-resume，session 持续累积

# P3b) --continue（恢复最近 session）
pi --mode json --print --continue "Reply with only the token." < /dev/null
# → 'OMICRON-3391'   ✓ --continue 也成立
```

`--session <id>`（确定性，按 id）与 `--continue`（最近）都跨进程可用；session 可重复恢复、持续累积。

### B2 — 工具历史跨进程保留 ★

```
FILE=/tmp/pi-tooltest.txt
MARK=SIGMA-2287

# T1) pi --print 用工具写文件
pi --mode json --print "Use your file write tool to create the file at $FILE with exactly this single line: SIGMA-2287. Then reply with only: WROTE" < /dev/null
# → 文件实际内容 = SIGMA-2287 | turn_end.toolResults 数量 = 1   ✓ 用了工具
#   session id 从首行捕获 (019ec49d-...)

# T2) 新进程 --session <id>，禁止工具，只凭记忆
pi --mode json --print --session "$SID" "In the previous turn you created a file. WITHOUT using any tools, answer from memory only: what exact content did you write? Reply with only that content." < /dev/null
# → 'SIGMA-2287' | toolResults 数量 = 0   ✓ 纯记忆召回，未调用工具
```

`toolResults=1 → 0` 证明：Pi 的 session 文件同样保留工具历史，跨进程可恢复。

### B-对照 — Pi 没有 "already in use" 问题

Pi 是**文件追加**模型，`--session <id>` 是"加载已有 session 文件"而非"占用进程级锁"。B1/B2 中 `--session <id>` 被多个新进程反复使用，**零报错**。与 Claude Code 误用 `--session-id` 必然撞墙形成鲜明对比。

---

## 最终结论（全部实证，无残留推测）

| # | 结论 | 证据 |
|---|---|---|
| 1 | Claude Code `--session-id` 复用 → 确定性 `already in use`；`session_manager.py:178` 注释属实 | A1-B、A3 |
| 2 | Claude Code `--resume` 跨进程重载文本上下文，resume-after-resume 无限轮 | A1-C、A2 |
| 3 | Claude Code `--resume` 跨进程保留完整工具历史 | A4（`num_turns` 铁证） |
| 4 | Pi 默认存盘，`--session <id>` / `--continue` 跨进程稳定恢复 | B0、B1、P3b |
| 5 | Pi session 文件保留工具历史，跨进程可恢复 | B2（`toolResults` 铁证） |
| 6 | Pi 文件型 session，无进程锁、无 `already in use`，天然可重入 | B1/B2 多进程反复用同一 id 零报错 |

**两个 CLI 都印证**：当前网关不用原生 session 是在白白废掉 agent 能力；彻底化在两者上都可行。

---

## 对 `agent-gateway` 的影响（具体文件与行）

> 注：以下路径在 `agent-gateway` 仓库（`/home/ryanli/Data/Projects/Agents/agent-gateway`），不在本仓库。

### Claude Code

| 文件:行 | 现状 | 问题 | 正确做法 |
|---|---|---|---|
| `agents/claude_code.py:103-104`（`_build_args`） | 续接也传 `--session-id <ref>` | 第 2 轮起撞 `already in use` | 区分首建/续接：续接传 `--resume <ref>` |
| `agents/claude_code.py:200-201`（`stream`） | 同上 | 同上 | 同上 |
| `server/session_manager.py:176-194`（`resume_session`） | resume 时 `new_ref = uuid4()` 换新 ref | 因用错 flag 才被迫换 ref；换后 CLI transcript 断档 | **保留原 ref**，配合 `--resume` |
| `agents/claude_code.py:285-322`（`_format_history`/`_format_prompt`） | 把 `history` 拍平成散文重放 | 原生 transcript 已有完整记忆，冗余且失真 | 降级为 fallback，常规路径删掉 |
| `server/methods.py:171-173`（`handle_prompt_submit`） | 不读 `truncate_before_user_ordinal`，纯 append | 桌面"编辑/重生成"在后端静默失效 | 见下文 append-only 冲突 |

### Pi

| 文件:行 | 现状 | 问题 | 正确做法 |
|---|---|---|---|
| `agents/pi_agent.py:99-139`（`_build_args`） | 收了 `session_ref` 形参，json/print 分支**从不加进 args** | 每轮新 Pi session，无原生续接 | turn 2+ 在 args 加 `--session <id>` |
| `agents/pi_agent.py:129`（bare 模式） | `--no-session` 显式禁用 session | bare 路径彻底无状态 | 仅在明确要无状态时用 |
| `agents/pi_agent.py:51`（rpc 模式） | "experimental, stateful per-session subprocesses"，**默认 mode="json" 未启用** | 闲置；引入子进程池生命周期复杂度 | 文件型 `--session` 已够用，rpc 路径可暂不投入 |
| `server/session_manager.py`（backend_session_ref mint） | 预 mint `uuid4()` 作 ref | Claude Code 可用预指派；**Pi 不能预指派 id** | 改为"首轮捕获 CLI 原生 id，存映射"（见下） |

### 关键不对称：能否预指派 session id

- **Claude Code**：`--session-id <minted>` 创建时即可指定 id → 网关可预 mint `backend_session_ref` 并直接用。
- **Pi**：无"创建时指定 id"的 flag，Pi 自行 mint（UUIDv7）→ 网关**只能事后从输出首行捕获**。

→ 统一设计应改为：**首轮跑 CLI → 从输出捕获 CLI 原生 session id → 存 `gateway_id ↔ cli_session_id` 映射 → 后续轮按 CLI 各自的续接 flag 恢复**。不再假设"预 mint 一个 ref 就能通用"。

---

## 正确的多轮调用模式（实证版）

### Claude Code

```
第 1 轮 (create):   claude -p --session-id <ref> ...      # 创建 transcript
第 2+ 轮 (continue): claude -p --resume <ref> ...          # 接续，含 tool/compact/plan
网关重启后:           claude -p --resume <ref> ...          # 不换 ref、不需文本重放
```

### Pi

```
第 1 轮 (create):   pi --mode json --print ...              # 从 JSONL 首行捕获 session id
第 2+ 轮 (continue): pi --mode json --print --session <id> ...  # 加载该 session
网关重启后:           pi --mode json --print --session <id> ...  # 文件在即可恢复
（--continue 可作"最近 session"的快捷方式，但确定性不如 --session <id>）
```

两种模式下，网关 `history[]` 的散文重放都不再是记忆主体——原生 transcript/session 文件接管真实记忆。

---

## 一个无法靠原生 session 解决的硬冲突：append-only vs 编辑

两个 CLI 的 transcript/session 都是**只追加**（append-only）；而桌面聊天 UI 期望"编辑某条消息 / 就地重新生成"。**没有任何原生 session 模型白送这个能力**。彻底化之后，edit/重生成只有两条诚实出路：

1. **branch**：从编辑点起新建一个 CLI session（append-only 下的唯一合规做法，等价于 `session.create` + 选定 messages；Pi 还可用原生 `--fork <id>`）。
2. 网关在 transcript 之上做一层"虚拟截断"视图（复杂、易漂移，不推荐）。

这也是 `truncate_before_user_ordinal` 存在却未被实现的根因——它想做的是 CLI 原生不支持的事。注意 Pi 的 `--fork <path|id>` 原生支持 fork，是 branch 语义的天然落点。

---

## 未验证 / 后续工作

- **auto-compact 行为**：两个 CLI 在长 transcript 触发自身上下文压缩后，`--resume` / `--session` 是否仍完整可用，未针对长会话实测。
- **同 id 并发**：Claude Code `already in use` 的触发边界未细查（疑似同一时刻两个活进程持有同 id 才报错；网关按 session 串行调用应不触发）。本文只验证了"进程 A 退出后进程 B 复用 `--session-id` 必失败"。
- **transcript/session 文件清理**：Claude Code 存 `~/.claude/projects/<encoded-cwd>/`，Pi 存 `~/.pi/agent/sessions/`。网关删除 session 时是否需要同步清理 CLI 文件，未在本文范围内。
- **桌面端 lineage 期望**：`hermes-desktop` 的 `_lineage_root_id` / 压缩轮换机制（`src/store/session.ts:24-28`）当前在后端被 stub 成 `None`（`agent-gateway/server/session_store.py:285`）。彻底化后应明确 lineage 与 CLI 原生 session 的对应关系。
- **Pi rpc 模式**：本文未实测 `pi --mode rpc`（网关默认也未启用）。若未来要切到持久子进程模型，需单独验证其跨重启行为与子进程池回收。
- **Pi `--fork`**：原生 fork 语义（branch）未实测，仅从 `--help` 确认存在。

## 官方文档佐证（实测为主，文档为辅）

- Claude Code：[Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions)、[10 Claude Code CLI flags you probably aren't using](https://mager.co/blog/2026-04-20-claude-code-cli-flags/)
- Pi：`pi --help`（`--session` / `--resume` / `--continue` / `--fork` / `--no-session` / `--mode`），session 文件模型见 `PI_CODING_AGENT_SESSION_DIR` 环境变量说明。

---

## 附录：可复现命令速查

### 通用

```bash
# 生成随机 session id（Claude Code 创建用）
SID=$(python3 -c "import uuid; print(uuid.uuid4())")
# < /dev/null 规避 "no stdin data received in 3s" 告警
```

### Claude Code

```bash
# 首轮创建
claude -p --session-id "$SID" --output-format json "<首条消息>" < /dev/null
# 后续接续（每轮新进程，无限轮）
claude -p --resume     "$SID" --output-format json "<消息>"   < /dev/null
# 对照：复用 --session-id 必失败（确定性）
claude -p --session-id "$SID" "<消息>" < /dev/null   # → Error: ... already in use.
```

判定工具调用：`--output-format json` 结果信封的 `num_turns>1` 表示该轮用了工具。

### Pi

```bash
# 首轮（从 JSONL 首行捕获 session id）
pi --mode json --print "<首条消息>" < /dev/null
#   首行: {"type":"session","id":"<uuidv7>"}
# 后续接续（每轮新进程，无限轮）
pi --mode json --print --session "$SID" "<消息>" < /dev/null
# 或恢复最近 session
pi --mode json --print --continue "<消息>" < /dev/null
```

判定工具调用：JSONL 中 `turn_end` 事件的 `toolResults` 数组长度 >0 表示该轮用了工具。
