# 数据中心变更窗口与回滚方案审阅平台

面向机房运维、系统、安全和业务负责人的生产变更审阅工作台。工程使用 Angular CLI 独立构建，所有变更记录会写入浏览器 `localStorage`，首次运行通过 `HttpClient` 加载 `public/mock/change-requests.json`。

## 技术栈

- Angular 22 + Angular CLI + TypeScript
- Clarity Angular 18 + Clarity UI
- NgRx Store + Effects
- Angular Router + HttpClient
- RxJS

## 功能

- 变更列表搜索，以及按状态、资源类型和风险等级筛选
- 新建变更方案，维护资源、依赖、执行步骤、回滚步骤、值守人员和窗口
- 依赖关系图与共享资源窗口甘特图
- 依赖遗漏、窗口冲突、回滚不可执行、关键服务观察窗口不足校验
- 网络、系统、安全、业务负责人顺序会签
- **送审版本固定**：每次送审把参与对象（机柜/依赖）、窗口、执行与回滚步骤摘要冻结为不可变版本
- **改动即失效**：会签中或已批准的方案一旦修改固定内容，旧版本所有签字失效，回到“待重新提交”，四方意见按新版本重走；仅改标题、风险、值守人员不影响签字
- 版本历史可查看每一版的参与对象、窗口、步骤摘要、前后差异和各版本的原始会签意见（含已失效版本）
- 执行页只读取当前有效版本的冻结快照，失效版本无法勾选执行；未全部会签通过不能开始执行
- 执行步骤勾选、实时日志入口、执行偏离记录、完成或回滚判定
- 审批冻结、审计轨迹和复盘 Markdown 导出
- 基于 NgRx 的状态流转与 localStorage 持久化（历史数据加载时自动补齐为 v1 版本）

## 运行

```bash
npm install
npm start
```

默认开发地址为 `http://localhost:18469`。

生产构建：

```bash
npm run build
```

构建输出位于 `dist/pair-wise-gsb-69/browser`。

## 目录

```text
src/app/
  components/             依赖图、甘特图、校验、审计组件
  models/                 领域模型和校验规则
  pages/                  列表、新建、详情工作区
  services/               HttpClient 数据加载、localStorage、复盘导出
  store/                  NgRx actions、reducer、effects、selectors
```
