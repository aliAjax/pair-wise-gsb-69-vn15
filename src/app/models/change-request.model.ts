export type ChangeStatus =
  | 'draft'
  | 'submitted'
  | 'resubmit'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'rolled_back'
  | 'rejected';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ResourceType = 'datacenter' | 'rack' | 'network' | 'storage' | 'service';
export type ApprovalStage = 'network' | 'system' | 'security' | 'business';
export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'frozen' | 'invalidated';
export type StepPhase = 'prepare' | 'execute' | 'verify' | 'rollback';
export type IssueSeverity = 'blocker' | 'warning' | 'info';

/** 送审版本所处阶段：会签中、已批准、已冻结、已退回、已失效（签字被新版本作废） */
export type VersionState =
  | 'in_review'
  | 'approved'
  | 'frozen'
  | 'rejected'
  | 'invalidated';

export interface ChangeResource {
  id: string;
  name: string;
  type: ResourceType;
  critical: boolean;
  dependencies: string[];
}

export interface ChangeStep {
  id: string;
  phase: StepPhase;
  title: string;
  owner: string;
  durationMinutes: number;
  command: string;
  completed: boolean;
  completedAt?: string;
}

export interface ChangeWindow {
  start: string;
  end: string;
  observationWindowMinutes: number;
  blackoutProtected: boolean;
}

export interface ApprovalRecord {
  stage: ApprovalStage;
  state: ApprovalState;
  approver?: string;
  decidedAt?: string;
  comment?: string;
}

/**
 * 送审方案的不可变快照。版本一旦随送审创建即固定参与对象、窗口和步骤摘要，
 * 后续编辑只修改工作副本，不再改动历史版本。
 */
export interface PlanVersion {
  /** 版本号，从 1 递增 */
  version: number;
  state: VersionState;
  createdAt: string;
  submittedBy: string;
  /** 本版本送审时的参与对象（资源与依赖） */
  resources: ChangeResource[];
  /** 本版本送审时的窗口 */
  window: ChangeWindow;
  /** 本版本送审时的执行/回滚步骤摘要（不含执行勾选状态） */
  steps: Array<Omit<ChangeStep, 'completed' | 'completedAt'>>;
  /** 网络、系统、安全、业务在本版本上的原始意见，版本失效后仍然保留 */
  approvals: ApprovalRecord[];
  /** 被作废时的说明，例如参与对象/窗口/步骤发生变化 */
  invalidatedReason?: string;
  invalidatedAt?: string;
}

export type VersionDiffKind = 'resource' | 'window' | 'step';

export interface VersionDiffEntry {
  kind: VersionDiffKind;
  label: string;
  change: string;
  from?: string;
  to?: string;
}

export interface VersionDiff {
  changed: boolean;
  entries: VersionDiffEntry[];
}

export interface DeviationRecord {
  id: string;
  recordedAt: string;
  owner: string;
  description: string;
  decision: 'continue' | 'pause' | 'rollback';
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  detail: string;
}

export interface ChangeRequest {
  id: string;
  title: string;
  summary: string;
  owner: string;
  onCall: string[];
  status: ChangeStatus;
  risk: RiskLevel;
  resources: ChangeResource[];
  steps: ChangeStep[];
  window: ChangeWindow;
  /** 当前会签状态的镜像，始终指向 currentVersion 上的意见，供会签 UI 使用 */
  approvals: ApprovalRecord[];
  deviations: DeviationRecord[];
  audit: AuditRecord[];
  /** 历次送审版本（按版本号升序），草稿为空 */
  versions: PlanVersion[];
  /** 当前有效版本号；草稿或待重新提交时为 null */
  currentVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationIssue {
  id: string;
  changeId: string;
  severity: IssueSeverity;
  code:
    | 'DEPENDENCY_MISSING'
    | 'WINDOW_CONFLICT'
    | 'ROLLBACK_UNEXECUTABLE'
    | 'OBSERVATION_TOO_SHORT'
    | 'OWNER_MISSING';
  title: string;
  detail: string;
  suggestedAction: string;
  relatedId?: string;
}

export const APPROVAL_ORDER: ApprovalStage[] = ['network', 'system', 'security', 'business'];

export const STATUS_LABELS: Record<ChangeStatus, string> = {
  draft: '草稿',
  submitted: '待会签',
  resubmit: '待重新提交',
  approved: '已批准',
  executing: '执行中',
  completed: '已完成',
  rolled_back: '已回滚',
  rejected: '已退回',
};

export const VERSION_STATE_LABELS: Record<VersionState, string> = {
  in_review: '会签中',
  approved: '已批准',
  frozen: '执行冻结',
  rejected: '已退回',
  invalidated: '已失效',
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
};

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  datacenter: '机房',
  rack: '机柜',
  network: '网络',
  storage: '存储',
  service: '服务',
};

export const STAGE_LABELS: Record<ApprovalStage, string> = {
  network: '网络负责人',
  system: '系统负责人',
  security: '安全负责人',
  business: '业务负责人',
};

export const PHASE_LABELS: Record<StepPhase, string> = {
  prepare: '准备',
  execute: '执行',
  verify: '验证',
  rollback: '回滚',
};

export function createEmptyApprovals(): ApprovalRecord[] {
  return APPROVAL_ORDER.map((stage) => ({ stage, state: 'pending' }));
}

export function createEmptyChange(): ChangeRequest {
  const now = new Date();
  const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

  return {
    id: `CHG-${Math.floor(1000 + Math.random() * 9000)}`,
    title: '',
    summary: '',
    owner: '',
    onCall: [],
    status: 'draft',
    risk: 'medium',
    resources: [],
    steps: [],
    window: {
      start: toLocalInputValue(start),
      end: toLocalInputValue(end),
      observationWindowMinutes: 30,
      blackoutProtected: false,
    },
    approvals: createEmptyApprovals(),
    deviations: [],
    audit: [],
    versions: [],
    currentVersion: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function isWindowOverlapping(left: ChangeWindow, right: ChangeWindow): boolean {
  const leftStart = new Date(left.start).getTime();
  const leftEnd = new Date(left.end).getTime();
  const rightStart = new Date(right.start).getTime();
  const rightEnd = new Date(right.end).getTime();
  return leftStart < rightEnd && rightStart < leftEnd;
}

export function validateChange(change: ChangeRequest, allChanges: ChangeRequest[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const resourceMap = new Map(change.resources.map((resource) => [resource.id, resource]));

  change.resources.forEach((resource) => {
    resource.dependencies
      .filter((dependencyId) => !resourceMap.has(dependencyId))
      .forEach((dependencyId) => {
        issues.push({
          id: `${change.id}-dependency-${resource.id}-${dependencyId}`,
          changeId: change.id,
          severity: 'blocker',
          code: 'DEPENDENCY_MISSING',
          title: `缺少依赖对象 ${dependencyId}`,
          detail: `${resource.name} 依赖 ${dependencyId}，但该对象未纳入本次变更范围。`,
          suggestedAction: '补充依赖对象，或提供不在范围内的书面依据。',
          relatedId: dependencyId,
        });
      });
  });

  allChanges
    .filter(
      (candidate) =>
        candidate.id !== change.id &&
        !['draft', 'rejected', 'resubmit', 'rolled_back'].includes(candidate.status) &&
        isWindowOverlapping(change.window, candidate.window),
    )
    .forEach((candidate) => {
      const shared = change.resources.filter((resource) =>
        candidate.resources.some((candidateResource) => candidateResource.id === resource.id),
      );
      if (shared.length > 0) {
        issues.push({
          id: `${change.id}-conflict-${candidate.id}`,
          changeId: change.id,
          severity: 'blocker',
          code: 'WINDOW_CONFLICT',
          title: `与 ${candidate.id} 存在窗口冲突`,
          detail: `共享资源：${shared.map((resource) => resource.name).join('、')}。两项变更的执行窗口发生重叠。`,
          suggestedAction: '调整窗口、串行等待，或将冲突资源移出本次范围。',
          relatedId: candidate.id,
        });
      }
    });

  change.steps
    .filter((step) => step.phase === 'rollback' && (!step.command.trim() || !step.owner.trim()))
    .forEach((step) => {
      issues.push({
        id: `${change.id}-rollback-${step.id}`,
        changeId: change.id,
        severity: 'blocker',
        code: 'ROLLBACK_UNEXECUTABLE',
        title: `回滚步骤“${step.title || '未命名'}”不可执行`,
        detail: '回滚步骤必须包含明确命令或操作说明，并指定责任人。',
        suggestedAction: '补齐回滚命令和责任人后重新校验。',
        relatedId: step.id,
      });
    });

  change.resources
    .filter((resource) => resource.type === 'service' && resource.critical)
    .forEach((resource) => {
      if (change.window.observationWindowMinutes < 30) {
        issues.push({
          id: `${change.id}-observation-${resource.id}`,
          changeId: change.id,
          severity: 'warning',
          code: 'OBSERVATION_TOO_SHORT',
          title: `${resource.name} 观察窗口不足`,
          detail: '关键服务建议至少保留 30 分钟观察窗口。',
          suggestedAction: '延长观察窗口，并由业务负责人签署风险接受记录。',
          relatedId: resource.id,
        });
      }
    });

  if (!change.owner.trim() || change.onCall.length === 0) {
    issues.push({
      id: `${change.id}-owner`,
      changeId: change.id,
      severity: 'blocker',
      code: 'OWNER_MISSING',
      title: '缺少变更责任人',
      detail: '变更负责人与值守人员均不能为空。',
      suggestedAction: '指定变更负责人和至少一名值守人员。',
    });
  }

  return issues;
}

export function createAudit(
  action: string,
  detail: string,
  actor = '当前用户',
): AuditRecord {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    actor,
    action,
    detail,
  };
}

/** 送审版本固定的内容：参与对象、窗口、步骤摘要 */
export interface VersionSnapshot {
  resources: ChangeResource[];
  window: ChangeWindow;
  steps: Array<Omit<ChangeStep, 'completed' | 'completedAt'>>;
}

export function buildSnapshot(change: ChangeRequest): VersionSnapshot {
  return {
    resources: change.resources.map((resource) => ({ ...resource, dependencies: [...resource.dependencies] })),
    window: { ...change.window },
    steps: change.steps.map(({ id, phase, title, owner, durationMinutes, command }) => ({
      id,
      phase,
      title,
      owner,
      durationMinutes,
      command,
    })),
  };
}

/**
 * 参与对象、窗口或步骤摘要是否发生变化的判定依据。
 * 只比较纳入版本固定的字段，标题、风险、值守人员等改动不影响旧签字。
 */
export function snapshotFingerprint(snapshot: VersionSnapshot): string {
  return JSON.stringify(snapshot);
}

export function getCurrentVersion(change: ChangeRequest): PlanVersion | null {
  if (change.currentVersion == null) {
    return null;
  }
  return change.versions.find((version) => version.version === change.currentVersion) ?? null;
}

export function createPlanVersion(change: ChangeRequest, submittedBy: string): PlanVersion {
  return {
    version: change.versions.length + 1,
    state: 'in_review',
    createdAt: new Date().toISOString(),
    submittedBy,
    ...buildSnapshot(change),
    approvals: createEmptyApprovals(),
  };
}

function formatTime(value: string): string {
  return value
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '—';
}

function resourceLabel(resource: ChangeResource): string {
  return `${resource.name}（${resource.id}）`;
}

/**
 * 计算两个送审版本（通常是相邻版本）在参与对象、窗口和步骤摘要上的前后差异，
 * 供“版本历史”页展示。
 */
export function diffVersions(previous: VersionSnapshot, next: VersionSnapshot): VersionDiff {
  const entries: VersionDiffEntry[] = [];

  const prevResources = new Map(previous.resources.map((resource) => [resource.id, resource]));
  const nextResources = new Map(next.resources.map((resource) => [resource.id, resource]));

  nextResources.forEach((resource, id) => {
    const before = prevResources.get(id);
    if (!before) {
      entries.push({
        kind: 'resource',
        label: `新增参与对象 ${resourceLabel(resource)}`,
        change: '新增',
        to: `依赖：${resource.dependencies.join('、') || '无'}`,
      });
      return;
    }
    if (before.name !== resource.name || before.type !== resource.type || before.critical !== resource.critical) {
      entries.push({
        kind: 'resource',
        label: `参与对象 ${resourceLabel(resource)} 属性变化`,
        change: '属性',
        from: `${RESOURCE_LABELS[before.type]}${before.critical ? '·关键' : ''}`,
        to: `${RESOURCE_LABELS[resource.type]}${resource.critical ? '·关键' : ''}`,
      });
    }
    const removedDeps = before.dependencies.filter((dep) => !resource.dependencies.includes(dep));
    const addedDeps = resource.dependencies.filter((dep) => !before.dependencies.includes(dep));
    if (removedDeps.length || addedDeps.length) {
      entries.push({
        kind: 'resource',
        label: `参与对象 ${resourceLabel(resource)} 依赖变化`,
        change: '依赖',
        from: before.dependencies.join('、') || '无',
        to: resource.dependencies.join('、') || '无',
      });
      void removedDeps;
      void addedDeps;
    }
  });
  prevResources.forEach((resource, id) => {
    if (!nextResources.has(id)) {
      entries.push({
        kind: 'resource',
        label: `移除参与对象 ${resourceLabel(resource)}`,
        change: '移除',
        from: `依赖：${resource.dependencies.join('、') || '无'}`,
      });
    }
  });

  const windowFields: Array<{ key: keyof ChangeWindow; label: string; fmt?: (v: string | number | boolean) => string }> = [
    { key: 'start', label: '窗口开始', fmt: (v) => formatTime(String(v)) },
    { key: 'end', label: '窗口结束', fmt: (v) => formatTime(String(v)) },
    {
      key: 'observationWindowMinutes',
      label: '观察窗口（分钟）',
      fmt: (v) => String(v),
    },
    {
      key: 'blackoutProtected',
      label: '封网保护',
      fmt: (v) => (v ? '是' : '否'),
    },
  ];
  windowFields.forEach(({ key, label, fmt }) => {
    if (previous.window[key] !== next.window[key]) {
      entries.push({
        kind: 'window',
        label,
        change: '窗口',
        from: fmt ? fmt(previous.window[key]) : String(previous.window[key]),
        to: fmt ? fmt(next.window[key]) : String(next.window[key]),
      });
    }
  });

  const prevSteps = new Map(previous.steps.map((step) => [step.id, step]));
  const nextSteps = new Map(next.steps.map((step) => [step.id, step]));
  nextSteps.forEach((step, id) => {
    const before = prevSteps.get(id);
    if (!before) {
      entries.push({
        kind: 'step',
        label: `新增${PHASE_LABELS[step.phase]}步骤“${step.title || '未命名'}”`,
        change: '新增',
        to: `${step.owner || '未指定责任人'}：${step.command || '未填写命令'}`,
      });
      return;
    }
    const fields: Array<{ key: keyof typeof step; label: string }> = [
      { key: 'title', label: '标题' },
      { key: 'phase', label: '阶段' },
      { key: 'owner', label: '责任人' },
      { key: 'command', label: '命令或操作' },
      { key: 'durationMinutes', label: '预计时长（分钟）' },
    ];
    fields.forEach(({ key, label }) => {
      if (before[key] !== step[key]) {
        entries.push({
          kind: 'step',
          label: `步骤“${before.title || step.id}”${label}变化`,
          change: label,
          from:
            key === 'phase'
              ? PHASE_LABELS[before.phase]
              : String(before[key] ?? '—'),
          to:
            key === 'phase' ? PHASE_LABELS[step.phase] : String(step[key] ?? '—'),
        });
      }
    });
  });
  prevSteps.forEach((step, id) => {
    if (!nextSteps.has(id)) {
      entries.push({
        kind: 'step',
        label: `删除${PHASE_LABELS[step.phase]}步骤“${step.title || '未命名'}”`,
        change: '删除',
        from: `${step.owner || '未指定责任人'}：${step.command || '未填写命令'}`,
      });
    }
  });

  return { changed: entries.length > 0, entries };
}

export function summarizeDiffReasons(diff: VersionDiff): string {
  if (!diff.changed) {
    return '送审内容发生变化';
  }
  const labels: Record<VersionDiffKind, string> = {
    resource: '参与对象（机柜/依赖）',
    window: '执行窗口',
    step: '执行/回滚步骤',
  };
  const kinds = new Set(diff.entries.map((entry) => entry.kind));
  return `旧签字失效：${[...kinds].map((kind) => labels[kind]).join('、')}已变更`;
}

/**
 * 将历史数据（引入版本机制之前的 localStorage / mock 记录）补齐为带版本结构：
 * 为每个已经送审的方案补建固定的 v1 版本，并保留原始会签意见。
 */
export function normalizeChange(raw: ChangeRequest): ChangeRequest {
  const change: ChangeRequest = {
    ...raw,
    resources: raw.resources ?? [],
    steps: raw.steps ?? [],
    approvals: raw.approvals?.length ? raw.approvals : createEmptyApprovals(),
    deviations: raw.deviations ?? [],
    audit: raw.audit ?? [],
    versions: raw.versions ?? [],
    currentVersion: raw.currentVersion ?? null,
  };

  if (change.versions.length > 0 || change.status === 'draft') {
    return change;
  }

  const stateByStatus: Partial<Record<ChangeStatus, VersionState>> = {
    submitted: 'in_review',
    rejected: 'rejected',
    approved: 'approved',
    executing: 'frozen',
    completed: 'frozen',
    rolled_back: 'frozen',
  };
  const state = stateByStatus[change.status];
  if (!state) {
    return change;
  }

  const v1: PlanVersion = {
    version: 1,
    state,
    createdAt: change.createdAt,
    submittedBy: change.owner || '历史数据',
    ...buildSnapshot(change),
    approvals: change.approvals.map((approval) => ({ ...approval })),
  };
  change.versions = [v1];
  change.currentVersion = 1;
  return change;
}
