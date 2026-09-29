export type ChangeStatus =
  | 'draft'
  | 'submitted'
  | 'resubmit_required'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'rolled_back'
  | 'rejected';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ResourceType = 'datacenter' | 'rack' | 'network' | 'storage' | 'service';
export type ApprovalStage = 'network' | 'system' | 'security' | 'business';
export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'frozen';
export type StepPhase = 'prepare' | 'execute' | 'verify' | 'rollback';
export type IssueSeverity = 'blocker' | 'warning' | 'info';

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

/** 方案版本状态：会签中 / 有效（已批准）/ 已失效（内容变更后旧签字作废） */
export type PlanVersionState = 'active' | 'invalidated' | 'superseded';

/** 送审方案的冻结快照：参与对象、窗口与步骤摘要不可变，会签意见随版本保存 */
export interface PlanVersion {
  version: number;
  submittedAt: string;
  submittedBy: string;
  /** active：当前有效（会签中或已批准）；invalidated：内容变更导致旧签字失效 */
  state: PlanVersionState;
  /** 旧版本失效原因，记录发生变化的摘要区块 */
  invalidatedAreas: PlanDiffArea[];
  invalidatedAt?: string;
  resources: ChangeResource[];
  window: ChangeWindow;
  steps: ChangeStep[];
  approvals: ApprovalRecord[];
}

/** 参与方案差异比较的摘要区块 */
export type PlanDiffArea = 'resources' | 'window' | 'steps';

export interface PlanFieldDiff {
  label: string;
  before: string;
  after: string;
}

export interface PlanVersionDiff {
  /** 发生变化的区块：参与对象、窗口、步骤摘要 */
  areas: PlanDiffArea[];
  resources: PlanFieldDiff[];
  steps: PlanFieldDiff[];
  window: PlanFieldDiff[];
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
  approvals: ApprovalRecord[];
  /** 历次送审版本，索引 0 为最新；执行页只读取 active 版本 */
  versions: PlanVersion[];
  /** 正在执行时锁定的版本号，执行勾选只能落在该冻结版本的步骤上 */
  executingVersion?: number;
  deviations: DeviationRecord[];
  audit: AuditRecord[];
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
  resubmit_required: '待重新提交',
  approved: '已批准',
  executing: '执行中',
  completed: '已完成',
  rolled_back: '已回滚',
  rejected: '已退回',
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
    versions: [],
    deviations: [],
    audit: [],
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

export function validateChange(
  change: ChangeRequest,
  allChanges: ChangeRequest[],
): ValidationIssue[] {
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
        !['draft', 'rejected', 'rolled_back'].includes(candidate.status) &&
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

export function createAudit(action: string, detail: string, actor = '当前用户'): AuditRecord {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    actor,
    action,
    detail,
  };
}

/* ------------------------------------------------------------------ */
/* 方案版本：送审冻结快照、签字失效判定与前后差异                        */
/* ------------------------------------------------------------------ */

export const DIFF_AREA_LABELS: Record<PlanDiffArea, string> = {
  resources: '参与对象',
  window: '窗口',
  steps: '步骤摘要',
};

/**
 * 送审时冻结方案快照。执行勾选状态不进入快照内容，
 * 因此执行中勾选步骤不会让方案指纹发生变化。
 */
export function snapshotPlan(
  change: Pick<ChangeRequest, 'resources' | 'window' | 'steps'>,
): Pick<PlanVersion, 'resources' | 'window' | 'steps'> {
  return {
    resources: change.resources.map((resource) => ({
      ...resource,
      dependencies: [...resource.dependencies],
    })),
    window: { ...change.window },
    steps: change.steps.map((step) => ({ ...step })),
  };
}

/** 方案变更比较基准：参与对象、窗口与步骤摘要（执行进度不参与） */
/** 当前有效（正在会签或已批准）的版本；失效版本不能用于执行 */
export function getActiveVersion(change: ChangeRequest): PlanVersion | undefined {
  return change.versions.find((version) => version.state === 'active');
}

/** 执行页只读的版本：优先执行锁定版本，其次当前有效版本 */
export function getEffectivePlan(change: ChangeRequest): PlanVersion | undefined {
  if (change.executingVersion) {
    const locked = change.versions.find((version) => version.version === change.executingVersion);
    if (locked) {
      return locked;
    }
  }
  return getActiveVersion(change);
}

function describeResource(resource: ChangeResource): string {
  const critical = resource.critical ? '（关键）' : '';
  const dependencies = resource.dependencies.length
    ? `，依赖 ${resource.dependencies.join('、')}`
    : '';
  return `${RESOURCE_LABELS[resource.type]} ${resource.id} ${resource.name}${critical}${dependencies}`;
}

function describeStep(step: ChangeStep): string {
  return `${PHASE_LABELS[step.phase]}｜${step.title}｜责任人 ${step.owner || '未指定'}｜${
    step.command || '无操作命令'
  }`;
}

/** 计算两个方案快照的前后差异；无差异时 areas 为空数组 */
export function diffPlanVersions(
  before: Pick<ChangeRequest, 'resources' | 'window' | 'steps'>,
  after: Pick<ChangeRequest, 'resources' | 'window' | 'steps'>,
): PlanVersionDiff {
  const diff: PlanVersionDiff = { areas: [], resources: [], steps: [], window: [] };

  const beforeResources = new Map(before.resources.map((resource) => [resource.id, resource]));
  const afterResources = new Map(after.resources.map((resource) => [resource.id, resource]));

  before.resources.forEach((resource) => {
    if (!afterResources.has(resource.id)) {
      diff.resources.push({
        label: `移除参与对象 ${resource.id}`,
        before: describeResource(resource),
        after: '—',
      });
    }
  });
  after.resources.forEach((resource) => {
    const previous = beforeResources.get(resource.id);
    if (!previous) {
      diff.resources.push({
        label: `新增参与对象 ${resource.id}`,
        before: '—',
        after: describeResource(resource),
      });
    } else if (describeResource(previous) !== describeResource(resource)) {
      diff.resources.push({
        label: `修改参与对象 ${resource.id}`,
        before: describeResource(previous),
        after: describeResource(resource),
      });
    }
  });

  const beforeSteps = new Map(before.steps.map((step) => [step.id, step]));
  const afterSteps = new Map(after.steps.map((step) => [step.id, step]));

  before.steps.forEach((step) => {
    if (!afterSteps.has(step.id)) {
      diff.steps.push({ label: `移除步骤 ${step.title}`, before: describeStep(step), after: '—' });
    }
  });
  after.steps.forEach((step) => {
    const previous = beforeSteps.get(step.id);
    if (!previous) {
      diff.steps.push({ label: `新增步骤 ${step.title}`, before: '—', after: describeStep(step) });
    } else if (describeStep(previous) !== describeStep(step)) {
      diff.steps.push({
        label: `修改步骤 ${step.title}`,
        before: describeStep(previous),
        after: describeStep(step),
      });
    }
  });

  const windowFields: PlanFieldDiff[] = [];
  if (before.window.start !== after.window.start) {
    windowFields.push({
      label: '窗口开始',
      before: before.window.start,
      after: after.window.start,
    });
  }
  if (before.window.end !== after.window.end) {
    windowFields.push({ label: '窗口结束', before: before.window.end, after: after.window.end });
  }
  if (before.window.observationWindowMinutes !== after.window.observationWindowMinutes) {
    windowFields.push({
      label: '观察窗口（分钟）',
      before: String(before.window.observationWindowMinutes),
      after: String(after.window.observationWindowMinutes),
    });
  }
  diff.window = windowFields;

  if (diff.resources.length) {
    diff.areas.push('resources');
  }
  if (diff.window.length) {
    diff.areas.push('window');
  }
  if (diff.steps.length) {
    diff.areas.push('steps');
  }
  return diff;
}

/**
 * 兼容旧数据：为没有版本记录的历史变更按当前状态补建冻结版本。
 * 已进入执行或终态的记录，旧签字随版本冻结保留。
 */
export function normalizeChange(change: ChangeRequest): ChangeRequest {
  if (change.versions?.length) {
    return change;
  }

  const needsVersion = !['draft'].includes(change.status);
  if (!needsVersion) {
    return { ...change, versions: [] };
  }

  const state: PlanVersionState =
    change.status === 'submitted' || change.status === 'approved' ? 'active' : 'superseded';
  const version: PlanVersion = {
    version: 1,
    submittedAt: change.createdAt,
    submittedBy: change.owner,
    state,
    invalidatedAreas: [],
    ...snapshotPlan(change),
    approvals: change.approvals.map((approval) => ({ ...approval })),
  };
  const executionLocked =
    change.status === 'executing' ||
    change.status === 'completed' ||
    change.status === 'rolled_back';
  return {
    ...change,
    versions: [version],
    executingVersion: executionLocked ? 1 : change.executingVersion,
  };
}
