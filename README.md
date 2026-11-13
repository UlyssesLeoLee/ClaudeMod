# dev-cockpit

Claude Code 的 mod：在聊天旁边提供多个功能窗格，以及输入框上方的一行按钮（📋 任务概要、📚 关联文档、🌿 分支记录）。除了下面写明的自动更新，所有 Git、文件扫描和模型调用都只在你点按钮或输入命令时执行。

## 分支变更（`/branch-status`）

- 查看 master、main、develop、dev 及你加入保护的分支的提交记录：可折叠，右侧是时间和作者；悬停看说明，点「📄 全文」打开提交详情。
- AI 提交标红；近 5 天的 AI 提交带 🚨，并在分支标题和按钮上报警。
- 「🛡 保护」把查询到的分支加入受保护列表。
- 「↩ 撤销」只出现在完全由你写的 AI 改动上：在临时工作区生成 revert，推送为 `revert/<哈希>` 分支，不改受保护分支。
- Worktree 列表：当前所在的高亮；可删除，删除前列出未提交改动、未合并提交、不在任何分支上的提交和被忽略的文件。
- 命令：`/branch-status master develop` 按这些分支查询。

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

## 需要的环境

- Git；Python 3（读取 Excel 内容、计算 SHA256；没有时相关功能会提示）；Windows 上的「📂 文件夹」用 PowerShell 把窗口切到前台。
- 窗格底部的「dev-cockpit 版本 · 代码 时间」显示当前会话加载的是哪一版。mod 的代码在会话打开后又更新过时，底部会出现黄色的「⚠ mod 代码已在 … 更新，本会话仍在用旧代码：重开会话后生效」。

## 安装

在 Claude Code 里先加入这个仓库作为插件市场，再安装：

```
claude plugin marketplace add UlyssesLeoLee/ClaudeMod
claude plugin install dev-cockpit@dev-cockpit
```

也可以从本机文件夹安装：`claude plugin marketplace add <本文件夹路径>`，再 `claude plugin install dev-cockpit@dev-cockpit`。

## 新增功能

`hooks/main.tsx` 是唯一的入口，每个功能一个文件夹：

| 文件夹 | 功能 |
| --- | --- |
| `hooks/branches/` | 分支变更 |
| `hooks/doclinks/` | 关联文档 |
| `hooks/overview/` | 任务概要 |
| `hooks/core/` | 公共部分：版本行、Git 与脚本调用、按项目保存、路径和时间 |

新功能放在 `hooks/<名字>/`，导出 `startX($)`（会话开始时的准备）、`registerX(on)`（命令和窗格）、`openX($)`（打开窗格），然后在 `hooks/main.tsx` 的三处各加一行；状态键写进 `types/index.d.ts` 的 `dev-cockpit` 下。

## 开发

- `claude plugin validate .`、`claude plugin test .`（`tests/*.test.tsx`）。
- Python 脚本的测试：`py -3 -m unittest discover -s tests -p "*_test.py"`。
- 源文件的设计文档和测试设计在 `.quality/` 下。

## 许可证

MIT 许可证加一条附加条件：安装或使用本 mod 之前，须发邮件通知作者 lidian727@gmail.com。全文见 [LICENSE](LICENSE)。
