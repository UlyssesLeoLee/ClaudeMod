# dev-cockpit

Claude Code 的 mod：在聊天旁边提供多个功能窗格，以及输入框上方的一行按钮（📋 任务概要、📚 关联文档、🌿 分支记录）。除了下面写明的自动更新，所有 Git、文件扫描和模型调用都只在你点按钮或输入命令时执行。

## 安装

### 1. 安装前

- **许可证要求**：安装或使用本 mod 之前，须发邮件通知作者 lidian727@gmail.com（见 [LICENSE](LICENSE)）。
- **Claude Code**：命令行版或桌面版均可，下面的命令在终端里执行。
- **Git**：分支变更、任务概要的核对和提交详情需要。
- **Python 3**（`python` 或 `py -3` 能运行即可）：读取 Excel 文档内容、计算文档 SHA256；没有时相关功能会在窗格里提示，其余照常可用。
- **Windows 的 PowerShell**：「📂 文件夹」用它把资源管理器窗口切到前台；没有时退回用 `explorer.exe` 打开。

### 2. 安装

把这个仓库加为插件市场，再安装 dev-cockpit：

```bash
claude plugin marketplace add UlyssesLeoLee/ClaudeMod
```

```bash
claude plugin install dev-cockpit@dev-cockpit
```

也可以一步完成（未加入的市场会先自动加入）：

```bash
claude plugin install dev-cockpit --marketplace UlyssesLeoLee/ClaudeMod
```

### 3. 确认已加载

安装后**新开一个会话**（已打开的会话不会加载新插件）：

- 输入框上方出现「📋 任务概要」「📚 关联文档」「🌿 分支记录」三个按钮，分支变更窗格自动打开；
- 每个窗格底部显示「dev-cockpit 版本 · 代码 时间」；
- `/branch-status`、`/doc-links`、`/task-overview` 三个命令可用。

### 4. 更新

```bash
claude plugin marketplace update dev-cockpit
```

```bash
claude plugin update dev-cockpit@dev-cockpit
```

更新后新开会话生效。会话打开期间 mod 的代码被更新时，窗格底部会出现黄色的「⚠ mod 代码已在 … 更新，本会话仍在用旧代码：重开会话后生效」。

### 5. 卸载

```bash
claude plugin uninstall dev-cockpit@dev-cockpit
```

```bash
claude plugin marketplace remove dev-cockpit
```

### 从源码使用（开发者）

不通过插件市场、直接用本地的源码：

```bash
git clone https://github.com/UlyssesLeoLee/ClaudeMod.git
```

然后在 `~/.claude/settings.json` 的 `env` 里把 `CLAUDE_CODE_PLUGIN_DIRS` 设为克隆下来的文件夹（例如 `"CLAUDE_CODE_PLUGIN_DIRS": "C:/Users/<你>/ClaudeMod"`），新开会话即可。用这种方式时不要再从插件市场安装，否则同一个 mod 会加载两份。

## 分支变更（`/branch-status`）

- 查看 master、main、develop、dev 及你加入保护的分支的提交记录：可折叠，右侧是时间和作者；悬停看说明，点「📄 全文」打开提交详情。
- AI 提交标红；近 5 天的 AI 提交带 🚨，并在分支标题和按钮上报警。
- 「🛡 保护」把查询到的分支加入受保护列表。
- 「↩ 撤销」只出现在完全由你写的 AI 改动上：在临时工作区生成 revert，推送为 `revert/<哈希>` 分支，不改受保护分支。
- Worktree 列表：当前所在的高亮；可删除，删除前列出未提交改动、未合并提交、不在任何分支上的提交和被忽略的文件。
- 命令：`/branch-status master develop` 按这些分支查询。
- 窗格最上面一直显示当前在哪里干活，不需要点任何按钮、不运行 Git，不是 Git 仓库的文件夹也显示：
  - `📍 运行目录`：命令实际运行的目录（在终端里 `cd` 之后会跟着变）；与项目根不同时单独列出项目根，运行目录不在项目根下会标黄。
  - Git 状态：不是 Git 仓库、普通仓库、linked worktree（标出主工作区在哪，提醒本会话的改动在 worktree 文件夹里、主工作区看不到）或子模块。
  - 「本会话改过的文件落在」：按 Edit/Write 类工具的实际落点统计——项目内、项目根之外（写出所在仓库的根目录）、Claude 的会话临时目录（`…\Temp\claude\…\scratchpad`，Claude 放中间文件的地方），最多列 6 处。用命令行（Bash）写的文件不在统计里。

## 关联文档（`/doc-links`）

- 「🔗 智能关联」按本会话记录判断任务，扫描项目里的文档（docs、doc、.quality 和名字像文档的文件夹）、加入的额外文档目录和相邻的同名项目文件夹，由 AI 把相关文档归入要件定义、基本设计、详细设计、UT/IT/ST 测试设计、SPEC、PLAN 和其他；每一类至少关联一份。
- 关联结果默认折叠：只显示每类的份数，点 ▶ 才展开文档。
- 关联后记录每份文档的 SHA256 和修改时间，「🔄 检查状态」看哪些改过了，「✔ 接受修改」把当前内容设为基准。
- 「📄 打开」用默认程序打开文档，「📂 文件夹」在资源管理器里显示并选中它。
- 「📝 按本任务改动更新」在你确认后把固定指令交给 Claude 修改文档（不提交），之后自动用 SHA256 核对；没改到的文档出现「📝 手动更新这些文档」。
- 本会话做过 review、之后又改了代码的那一轮结束时，会自动更新关联文档并核对。
- 文档在另一个文件夹时：`/doc-links add <路径>`、`/doc-links remove <路径>`、`/doc-links list`，或点窗格里的「➕ 添加文档目录」。
- 关联结果按项目根目录保存：会话的终端进入项目的子文件夹后，看到的仍是这个项目的关联。

## 任务概要（`/task-overview`）

- 读取 `docs/WBS.md`，统计完成度（有工数时按工数加权）、列出未完成任务（逾期标红），由 AI 对照 Git 写不超过 140 字的概要并标出与实际不符的任务。
- 没有 WBS 时，「📝 新建 WBS」在你确认后让 Claude 按固定格式新建。
- 未完成任务先列 30 项，「▶ 另有 N 项」展开其余，「▲ 收起」收回；鼠标悬停在任务上显示它的全部文字和各项字段，点一下任务则固定显示，再点收起。

## .nema 文件

`.nema` 用不同的领域头（` \编号 修订号`，`\?` 为 5W1H，`\>` 为节点–边拓扑，无标记为表格）把一个文件分给多个 agent 共同编辑：每个 agent 只改自己的领域，并把该领域的修订号加 1。语法见 nema-thread 的语法规范。

- 关联文档：`.nema` 文件和其他文档一样参与扫描和关联，AI 读的是它的领域摘要。关联时记下每个领域的修订号和指纹，「🔄 检查状态」后列出哪些领域被改过、新增或删除；内容改了但修订号没加的领域标黄，语法错误标红并给出行号。更新文档的指令会要求 Claude 只改相关领域并把修订号加 1。
- 任务概要：没有 `docs/WBS.md` 时读取 `docs/WBS.nema`，取其中第一个带「任务」列的表格领域。
- 分支变更：点开一条提交的「提交详情」时，列出它改动的 `.nema` 文件里哪些领域变了、修订号是否增加。
- 以 CRLF 换行的 `.nema` 文件按 LF 读取（Windows 上 Git 检出时会转成 CRLF）。

## 新增功能

`hooks/main.tsx` 是唯一的入口，每个功能一个文件夹：

| 文件夹 | 功能 |
| --- | --- |
| `hooks/branches/` | 分支变更 |
| `hooks/doclinks/` | 关联文档 |
| `hooks/overview/` | 任务概要 |
| `hooks/core/` | 公共部分：版本行、Git 与脚本调用、按项目保存、.nema 解析、路径和时间 |

新功能放在 `hooks/<名字>/`，导出 `startX($)`（会话开始时的准备）、`registerX(on)`（命令和窗格）、`openX($)`（打开窗格），然后在 `hooks/main.tsx` 的三处各加一行；状态键写进 `types/index.d.ts` 的 `dev-cockpit` 下。

## 开发

- `claude plugin validate .`、`claude plugin test .`（`tests/*.test.tsx`）。
- Python 脚本的测试：`py -3 -m unittest discover -s tests -p "*_test.py"`。
- 源文件的设计文档和测试设计在 `.quality/` 下。

## 许可证

MIT 许可证加一条附加条件：安装或使用本 mod 之前，须发邮件通知作者 lidian727@gmail.com。全文见 [LICENSE](LICENSE)。
