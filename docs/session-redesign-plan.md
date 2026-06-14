# Session 架构改进方案

> 制定日期：2026-06-14
> 依据：本机实测结论见同目录 [`cli-session-semantics.md`](./cli-session-semantics.md)。
> 范围：`agent-gateway`（后端）+ `hermes-desktop`（客户端）两端。
> 目标：让 agent CLI（Claude Code / Pi）的**原生 session 成为对话上下文的唯一真实来源**，恢复工具调用历史 / 上下文压缩 / 任务状态能力，同时保持客户端编辑、重生成、置顶等交互的顺畅稳定。

---

## TL;DR

当前两个 CLI 的原生 session 机制**都没有被正确使用**，agent 实质上被降级成无状态 LLM：

- **Claude Code**：每轮传 `--session-id <预铸UUID>` 且**文本重放**整段 history —— 双份记账；且 `--session-id` 复用在实测中会 `already in use`（见 `session_manager.py:176-179` 的注释，已实测为真），开发者的"修复"是在 resume 时重新 mint ref，结果**每个桌面 session 的 native 上下文从未跨轮累积**。
- **Pi（默认 json 模式）**：`session_ref` 参数被接收却**从不拼进 args**（`pi_agent.py:116-139`），`_format_prompt` 在 json 模式也只返回 `message`（`pi_agent.py:430`）—— 既无 native session、又无文本重放，**完全无状态**，每轮都是失忆的新 agent。

本方案分三阶段，**Phase 1 即可恢复 95% 场景的能力且风险最低**：

| 阶段 | 目标 | 风险 | 收益 |
|---|---|---|---|
| **Phase 1** | 接通原生 session 续接，停止文本重放 | 低（bridge 局部改动） | 恢复工具历史 / 压缩 / 状态，token 更省，回答更连贯 |
| **Phase 2** | 让编辑 / 重生成在 append-only 转录下行为诚实 | 中 | 修掉 `truncate_before_user_ordinal` 这个**静默 no-op** |
| **Phase 3** | 置顶稳定性（lineage root）+ 清理死代码 | 低 | 修掉置顶在压缩轮换后"消失"的隐患 |

---

## 一、根因诊断（已定位到 file:line）

### Bug 1 — Claude Code：`--session-id` 被当续接 flag 反复复用
- `claude_code.py:103-104`（`_build_args`）与 `claude_code.py:200-201`（`stream`）：`if session_ref: args.extend(["--session-id", session_ref])`。
- `session_manager.py:109`：`ref = backend_session_ref or str(uuid.uuid4())`，**整个 desktop session 生命周期内 ref 固定不变**，每轮都拿同一个值走 `--session-id`。
- 实测（`cli-session-semantics.md` 实验 A2）：`--session-id` 是**创建即占用**语义，复用报 `already in use`。`--resume <id>` 才是跨进程确定性续接。
- 后果：要么续接报错，要么（若顺序复用恰好放行）native 上下文也并未按预期累积——无论哪种，都不如直接用 `--resume`。

### Bug 2 — Pi：native session flag 根本没接
- `pi_agent.py:99-139`（`_build_args`）接收 `session_ref` 形参，但 json/print 分支**从不 append 它**。
- `pi_agent.py:430`（`_format_prompt`，json 分支）：`return message` —— 连文本 history 都不重放。
- 后果：Pi json 模式每轮都是全新失忆 session，网关 `session.history` 只用于展示，agent 完全看不到。

### Bug 3 — 双份记账（Claude）/ 既不 native 也不重放（Pi）
- Claude：`claude_code.py:316-318` 的 `_format_prompt` 在 prompt 前拼 `Previous conversation:\nHuman:.../Assistant:...` 文本，**同时**还传 native flag。一旦 native 接通，这段文本重放就是**冗余 + 上下文污染 + 工具结构丢失**。

### Bug 4 — `truncate_before_user_ordinal` 是静默 no-op
- 客户端编辑 / 重生成时（`use-prompt-actions.ts` 的 `editMessage` / `reloadFromMessage`）发送 `truncate_before_user_ordinal`。
- 网关 `methods.py:171-173`（`handle_prompt_submit`）**只读** `session_id` / `text` / `system_prompt`，**完全不读** `truncate_before_user_ordinal`。
- 后果：客户端以为"截断 + 重发"生效，网关却原样在完整 history 上续接——编辑实际没改变 agent 记住的内容。

### Bug 5 — `_lineage_root_id` 被 stub 成 `None`
- `session_store.py:285`：`"_lineage_root_id": None`。
- 客户端置顶逻辑（`session.ts:27` 的 `sessionPinId`）依赖它跨压缩轮换保持稳定；为 `None` 时退回 `id`，压缩轮换后置顶会"消失直到刷新"。

---

## 二、目标架构

### 核心原则
> **CLI 原生 session = 上下文唯一真实来源；网关只维护「desktop session → native session」的映射与展示用 history。**

native session 一旦接通，网关 `session.history` 不再注入 prompt，仅用于：客户端展示、标题生成、迁移兜底。

### 数据模型（`DesktopSession`）

```
desktop_session_id  ──映射──>  cli_session_id（native，事后捕获）
                      │
                      └─ 首轮由 CLI 创建、从输出捕获、持久化
```

新增字段：

```python
cli_session_id: str | None = None   # 捕获到的 native session id；None = 尚未创建
```

`backend_session_ref`（旧预铸 UUID）**不再作为 CLI flag 使用**，Phase 3 清理。

### 生命周期（统一规则）

| 时机 | `cli_session_id` | bridge 行为 | history 处理 |
|---|---|---|---|
| 全新 session 首轮 | `None`，history 为空 | 无 flag，CLI 自建 session | 不注入（裸 message） |
| 迁移：旧 session 恢复后首轮 | `None`，history 非空 | 无 flag，CLI 自建 session | **注入 history 作种子**（一次性，工具历史降级为文本） |
| 正常第 2+ 轮 | 已捕获 | native 续接 flag | **不注入**（CLI 自己有完整上下文） |
| 编辑 / 重生成（Phase 2） | 置 `None`，history 截断 | 等同"迁移首轮" | 注入截断后 history 作种子 |

> **关键洞察**：history 文本注入退化为**兜底**——仅当 `cli_session_id is None` 时使用。这天然覆盖了「全新首轮」和「迁移/编辑首轮」两种需要种子的场景，无需专门迁移代码，且**自愈**：native session 文件被删也只损失一轮就恢复。

---

## 三、Phase 1：接通原生 session 续接（高收益 / 低风险）

### 1.1 bridge 捕获 native id

每个 `DesktopSession` 持有独立 bridge 实例（`session_manager.py:110` `create_bridge` 每会话一份），故 bridge 可持单值：

```python
# CLIAgentBridge.__init__（base.py:316）新增：
self.captured_cli_session_id: str | None = None
```

- **Claude**：`claude_code.py:257` 的 `_parse_stream_line` 在 `event_type == "result"` 分支里，先抓 `data.get("session_id")` 存入 `self.captured_cli_session_id`，再 `return ""`。约 2 行。
- **Pi**：`pi_agent.py:275` 的 `_parse_json_stream_line` 增加 `elif event_type == "session": self.captured_cli_session_id = data.get("id")`。约 2 行。

### 1.2 bridge 改用 native 续接 flag、停止文本重放

- **Claude**（`claude_code.py:103-104` 与 `200-201`）：
  ```python
  # 旧
  if session_ref: args.extend(["--session-id", session_ref])
  # 新
  if session_ref: args.extend(["--resume", session_ref])
  ```
  `claude_code.py:316-318` 的 `_format_prompt`：移除 `Previous conversation:` 拼接（见 1.4 的兜底规则）。

- **Pi**（`pi_agent.py:116-139` json 分支 + `241-273` `_stream_json`）：
  ```python
  if session_ref: args.extend(["--session", session_ref])
  ```

### 1.3 网关改传捕获值、并在轮结束后回写

`methods.py:230-236`（`_run_prompt`）：

```python
# 旧
session_ref=session.backend_session_ref,
# 新
session_ref=session.cli_session_id,
```

stream 循环结束后（`methods.py:262` 附近）：

```python
if getattr(session.bridge, "captured_cli_session_id", None):
    session.cli_session_id = session.bridge.captured_cli_session_id
    sessions.persist_session(session_id)
```

### 1.4 history 注入退化为兜底

统一规则：**仅当 `session_ref is None and history` 时，bridge 才把 history 拼进 prompt；否则只发 `message`。**

- Claude `_format_prompt`（`claude_code.py:304-322`）：把 `if history_text:` 改为 `if session_ref is None and history_text:`（需把 `session_ref` 透传进 `_format_prompt`，或在 `stream()` 里据 `session_ref` 决定是否调用带 history 的拼装）。
- Pi `_format_prompt`（`pi_agent.py:408-430`）：print 分支同样改成 `session_ref is None` 才拼；json 分支本就只发 `message`，保持。

### 1.5 `session_manager.resume_session` 不再重 mint ref

`session_manager.py:176-179`：删除"重新生成 ref 以规避 already in use"的逻辑，恢复时直接用持久化的 `cli_session_id`（若有）。旧记录无 `cli_session_id` → 自然走 1.4 兜底（首轮种 history 后捕获）。

### Phase 1 验证

复用 `cli-session-semantics.md` 附录的实测命令：

1. 多轮 + 工具记忆：`创建文件 X 并记住名字` → 新轮 `刚才那个文件叫什么` → 期望 agent 凭 native session 回忆（而非靠网关文本重放）。
2. 对比 token：Phase 1 后第 2+ 轮 prompt 应**不含** `Previous conversation:` 文本块，input tokens 显著下降。
3. Claude：抓 `result` envelope 的 `num_turns` / `session_id`，确认跨轮 session_id 稳定、turn 累积。
4. Pi：抓首行 `{"type":"session","id":...}`，确认跨轮 id 稳定、`toolResults` 沿用。

---

## 四、Phase 2：诚实的编辑 / 重生成（append-only 下的唯一可行解）

### 4.1 不可调和的矛盾

两个 CLI 的转录都是 **append-only**：native session 只能往前长，无法"截断到第 N 轮"。客户端的"原地编辑第 3 条 + 重生成"在语义上等价于**分支**，不是原地改写。Phase 1 后这个矛盾会**暴露**——`--resume` 续接的是完整原始转录，编辑的第 3 条根本不生效。

### 4.2 方案：截断 + 重铸 native session（同 desktop session，工具历史在编辑点降级为文本）

让 `truncate_before_user_ordinal` 真正生效：

- `handle_prompt_submit`（`methods.py:171`）读取 `truncate_before_user_ordinal: i`。
- `_run_prompt`：若收到 `i`，先 `session.history = session.history[:i]`，追加编辑后的 user 文本，**置 `session.cli_session_id = None`**。
- 下一轮：`cli_session_id is None` + history 非空 → 命中 Phase 1 的兜底规则 → 以截断后 history 作种子重铸一个新 native session。

**代价（诚实标注）**：编辑点之前的工具调用历史会被压扁成纯文本种子，工具结果结构丢失。这是 append-only CLI **没有 turn 级 fork** 时的固有限制，无法绕过。

### 4.3 Pi 的潜在升级：native `--fork`（需先验证）

`pi --fork <id>` 可能源生分支。若支持 **turn 级 fork**（从第 N 轮分叉），则 Pi 编辑可保留完整工具历史——把 4.2 的"重铸+文本种子"替换为 `--fork`。**尚需实测** `--fork` 是否支持指定 fork 点（见「待验证」）。Claude Code 无 fork flag，只能走 4.2。

### Phase 2 验证

1. 编辑中间一条消息后重生成 → 新回答不应引用被删掉的后续轮内容。
2. 确认网关 `session.history` 被正确截断到 `i`。
3. 确认 `cli_session_id` 被重置、下一轮捕获到新 native id。

---

## 五、Phase 3：置顶稳定性 + 清理

### 5.1 填充 `_lineage_root_id`

`session_store.py` 创建记录时：`_lineage_root_id = session_id`（自身即根；分支继承父根）。修复 `session.ts:27` 的 `sessionPinId` 在压缩轮换 / 分支后失效的隐患。

### 5.2 清理 `backend_session_ref`

- 停止在 `create_session`（`session_manager.py:109`）mint 该 UUID。
- 持久化记录里保留旧字段以兼容旧数据，读取时若 `cli_session_id` 缺失则尝试回退（迁移首轮兜底会自然捕获）。
- 删除 `session_manager.py:176-179` 已失效的"重 mint ref"注释 / 逻辑。

---

## 六、迁移与向后兼容

- **旧持久化 session**（有 `history`、无 `cli_session_id`）：恢复后首轮自动命中兜底（注入 history 种子 → 捕获新 native id）。**无需手写迁移**，一次性承受工具历史降级。
- **native session 文件被用户清除**（`~/.claude` / `~/.pi`）：`--resume` 会失败。bridge 应捕获该错误 → 回退为无 flag 的 fresh create + 兜底种子 → 重新捕获 id。**自愈，损失一轮。**
- 客户端 `backend_session_ref` 字段：当前仅作展示，改服务端用法不影响客户端。

---

## 七、待验证（动手前需补的实测）

1. **Pi `--fork` 是否支持 turn 级 fork 点？** 决定 Phase 2 中 Pi 编辑能否保留工具历史。命令草案：`pi --fork <id>` 后检查新 session 是否从最新轮分叉；尝试 `pi --fork <id>:<turn>` 之类语法是否存在。
2. **Claude `--session-id` 顺序复用（非并发）是否也 `already in use`？** 早前实测 B 可能是并发场景。虽然 Phase 1 改用 `--resume` 后此问题不再相关，但需确认旧路径确实坏、以坐实迁移必要性。
3. **Claude `--resume` 在 session 文件缺失时的错误形态**：用于写 bridge 的 fresh-create 回退检测。

---

## 八、风险与发布

- **Phase 1 可独立发布**，是纯收益项（恢复能力 + 省 token + 更连贯），改动集中在 bridge 与 `_run_prompt`，可加 feature flag（如网关配置 `native_session: true`）灰度。
- **Phase 2 需客户端配合**（编辑流已发 `truncate_before_user_ordinal`，只需网关开始读它），但会**改变编辑后的 agent 行为**（工具历史在编辑点降级），需在 UI 文案或 changelog 明示。
- **Phase 3 低风险**，可随 Phase 1 一起做。

建议落地顺序：**Phase 1 →（灰度验证）→ Phase 3 → Phase 2**。
