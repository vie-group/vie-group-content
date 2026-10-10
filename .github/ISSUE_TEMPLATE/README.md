# Issue Templates / Issue 模板

本目录保存内容提交相关的 Issue 模板，因为本仓库是网站内容数据的唯一来源。
Content submission issue templates live here because this repository is the source of truth for website content.

公开网站的 `upload-seminar/` 页面会在本仓库中打开预填好的组会提交 Issue。
The public website's `upload-seminar/` page opens pre-filled seminar issues in this repository.

公开网站的 `edit-seminar/` 页面会在本仓库中打开预填好的组会编辑 Issue。
The public website's `edit-seminar/` page opens pre-filled edit issues in this repository.

公开网站的 `edit-publication/` 页面会在本仓库中打开预填好的论文编辑 Issue。
The public website's `edit-publication/` page opens pre-filled publication edit issues in this repository.

公开网站的 `edit-team/` 页面会在本仓库中打开预填好的团队编辑 Issue。
The public website's `edit-team/` page opens pre-filled team edit issues in this repository.

内容修改 workflow 只处理被识别为 `vie-group` 组织成员打开的 Issue；对于 GitHub 因私有成员身份将组织 Owner 显示为 `CONTRIBUTOR` 的情况，也允许仓库 admin 作为兜底。外部用户和非 admin 外部协作者的请求会被关闭且不会修改数据。
The content-changing issue workflow only processes issues opened by recognized `vie-group` organization members, with a repository-admin fallback for organization owners whose private membership is reported by GitHub as `CONTRIBUTOR`. External users and non-admin external collaborators are closed without changing data.

已关闭的内容修改 Issue 可以通过 reopen 重试；统一内容 workflow 会监听 `opened`、`edited` 和 `reopened` Issue 事件。
Closed content-change issues can be retried by reopening them; the unified content issue workflow listens to `opened`, `edited`, and `reopened` issue events.

仓库 owner/admin 可以通过 reopen 其它用户提交失败的内容 Issue，或在 Issue 下评论 `/force-merge` 来强制处理。`/force-retry` 和 `/retry-content` 也可作为别名。
Repository owners/admins can force-process a failed content issue opened by another user by reopening it, or by commenting `/force-merge` on the issue. `/force-retry` and `/retry-content` are accepted aliases.

编辑组会时，请保持 `Original Seminar ID` 不变。可选 URL 字段表示完整最终值：保留 URL 表示继续使用，清空表示移除，或将替换文件拖入对应附件框以替换为仓库本地资源。
For seminar edits, keep `Original Seminar ID` unchanged. The optional URL fields are the complete final values: keep a URL to retain it, clear it to remove it, or drag a replacement file into the matching attachment box to replace it with a repository-local asset.

编辑论文时，请保持 `Original Publication ID` 不变。可选 URL 字段同样表示完整最终值；附件会复制到 `assets/publications/`。
For publication edits, keep `Original Publication ID` unchanged. The optional URL fields are also the complete final values; attachments are copied into `assets/publications/`.

编辑团队成员时，`Operation` 控制 add/update/delete，`Target Group` 是最终状态（`faculty`、`current` 或 `alumni`）。网站生成的批量编辑会包含 JSON 格式的 `Batch Changes` 字段，可在一个 Issue 中更新多条现有记录。单人成员编辑中的头像附件会复制到 `assets/team/`。
For team edits, `Operation` controls add/update/delete, and `Target Group` is the final status (`faculty`, `current`, or `alumni`). Website-generated batch edits include a JSON `Batch Changes` field and can update multiple existing records in one issue. Portrait attachments are copied into `assets/team/` for single-person edits.
