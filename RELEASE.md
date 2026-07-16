# Release Workflow

每次发布新版本时按以下步骤操作。

## 流程

1. **确认变更已合入 main**
   - 所有相关 PR 已合入 `main` 分支
   - 本地 `git checkout main && git pull`

2. **更新版本号**
   - 编辑 `package.json` 中的 `version` 字段（遵循 semver）
   - `npm install` 同步 `package-lock.json`

3. **更新 CHANGELOG**
   - 在 `CHANGELOG.md` 顶部添加新版本 entry
   - 从 `git log --oneline <上一个tag>..HEAD` 总结变更
   - 按 Added / Changed / Fixed / Docs 分类
   - 如果当前版本是 Unreleased，补上发布日期

4. **提交并打 tag**
   ```bash
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "chore: release vX.Y.Z"
   git tag vX.Y.Z
   git push && git push --tags
   ```

5. **验证 CI**
   - 确认 GitHub Actions 构建通过
   - 确认多平台产物正常

## 版本命名规则

- 遵循 [SemVer](https://semver.org/)：`MAJOR.MINOR.PATCH`
- tag 名称与 `package.json` 的 `version` 保持一致，加 `v` 前缀
- 例如 `package.json` 中 `"version": "0.2.1"` → tag `v0.2.1`

## 注意事项

- 不要在发布 commit 中夹带功能变更
- 发布前确认所有测试通过：`npm test`
- 如果发布后发现严重问题，先 `git revert` 再修复合入，不要直接修改已推送的 tag
