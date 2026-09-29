import { createReducer, on } from '@ngrx/store';
import {
  ApprovalRecord,
  ApprovalStage,
  ChangeRequest,
  APPROVAL_ORDER,
  PlanDiffArea,
  PlanVersion,
  createAudit,
  createEmptyApprovals,
  diffPlanVersions,
  getActiveVersion,
  normalizeChange,
  snapshotPlan,
} from '../models/change-request.model';
import { ChangeRequestActions } from './change-request.actions';

export interface ChangeRequestState {
  changes: ChangeRequest[];
  loading: boolean;
  error: string | null;
}

export const initialChangeRequestState: ChangeRequestState = {
  changes: [],
  loading: false,
  error: null,
};

function touch(change: ChangeRequest): ChangeRequest {
  return { ...change, updatedAt: new Date().toISOString() };
}

function nextPendingStage(change: ChangeRequest): ApprovalStage | null {
  return (
    APPROVAL_ORDER.find((stage) =>
      change.approvals.some((approval) => approval.stage === stage && approval.state === 'pending'),
    ) ?? null
  );
}

/** 把新的会签结果同步写入当前有效版本，保证版本自带原意见 */
function syncActiveVersionApprovals(
  change: ChangeRequest,
  approvals: ApprovalRecord[],
): PlanVersion[] {
  return change.versions.map((version) =>
    version.state === 'active'
      ? { ...version, approvals: approvals.map((item) => ({ ...item })) }
      : version,
  );
}

/**
 * 会签中或已批准的方案，一旦参与对象、窗口、步骤摘要发生变化：
 * 当前版本失效（旧签字保留在历史版本中），方案回到待重新提交。
 */
function invalidateActiveVersion(
  change: ChangeRequest,
  updated: ChangeRequest,
): ChangeRequest | null {
  const active = getActiveVersion(change);
  if (!active || !['submitted', 'approved'].includes(change.status)) {
    return null;
  }

  const diff = diffPlanVersions(active, updated);
  if (diff.areas.length === 0) {
    return null;
  }

  const areasText = diff.areas
    .map((area) => ({ resources: '参与对象', window: '窗口', steps: '步骤摘要' })[area])
    .join('、');
  const invalidatedAt = new Date().toISOString();

  return touch({
    ...updated,
    status: 'resubmit_required',
    approvals: createEmptyApprovals(),
    versions: change.versions.map((version) =>
      version.state === 'active'
        ? {
            ...version,
            state: 'invalidated' as const,
            invalidatedAreas: diff.areas as PlanDiffArea[],
            invalidatedAt,
          }
        : version,
    ),
    audit: [
      createAudit(
        '版本签字失效',
        `送审版本 v${active.version} 的${areasText}已修改，原会签意见全部失效，方案回到待重新提交`,
      ),
      ...updated.audit,
    ],
  });
}

export const changeRequestReducer = createReducer(
  initialChangeRequestState,
  on(ChangeRequestActions.loadChanges, (state) => ({ ...state, loading: true, error: null })),
  on(ChangeRequestActions.loadChangesSuccess, (state, { changes }) => ({
    ...state,
    changes: changes.map((change) => normalizeChange(change)),
    loading: false,
  })),
  on(ChangeRequestActions.loadChangesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(ChangeRequestActions.createChange, (state, { change }) => ({
    ...state,
    changes: [
      {
        ...change,
        versions: change.versions ?? [],
        audit: [createAudit('创建草稿', `创建变更 ${change.id}`), ...change.audit],
      },
      ...state.changes,
    ],
  })),
  on(ChangeRequestActions.updateChange, (state, { change }) => ({
    ...state,
    changes: state.changes.map((item) => {
      if (item.id !== change.id) {
        return item;
      }

      const updated: ChangeRequest = {
        ...change,
        versions: change.versions ?? item.versions,
        audit: [createAudit('保存变更方案', '更新资源、步骤或窗口信息'), ...change.audit],
      };

      return invalidateActiveVersion(item, updated) ?? touch(updated);
    }),
  })),
  on(ChangeRequestActions.deleteDraft, (state, { id }) => ({
    ...state,
    changes: state.changes.filter((change) => change.id !== id || change.status !== 'draft'),
  })),
  on(ChangeRequestActions.submitForReview, (state, { id }) => ({
    ...state,
    changes: state.changes.map((change) => {
      if (change.id !== id || !['draft', 'rejected', 'resubmit_required'].includes(change.status)) {
        return change;
      }

      const now = new Date().toISOString();
      const approvals = createEmptyApprovals();
      const version: PlanVersion = {
        version: (change.versions[0]?.version ?? 0) + 1,
        submittedAt: now,
        submittedBy: change.owner,
        state: 'active',
        invalidatedAreas: [],
        ...snapshotPlan(change),
        approvals: approvals.map((item) => ({ ...item })),
      };

      // rejected 后直接重新送审：内容变化则旧版本判失效，否则归档；保证至多一个 active
      const priorActive = change.versions.find((candidate) => candidate.state === 'active');
      let priorVersions = change.versions;
      let submitDetail: string;
      if (priorActive) {
        const diff = diffPlanVersions(priorActive, change);
        if (diff.areas.length > 0) {
          const areasText = diff.areas
            .map((area) => ({ resources: '参与对象', window: '窗口', steps: '步骤摘要' })[area])
            .join('、');
          priorVersions = change.versions.map((candidate) =>
            candidate.state === 'active'
              ? {
                  ...candidate,
                  state: 'invalidated' as const,
                  invalidatedAreas: diff.areas as PlanDiffArea[],
                  invalidatedAt: now,
                }
              : candidate,
          );
          submitDetail = `退回方案 v${version.version} 重新冻结，${areasText}已修改，四方意见按新版本重走`;
        } else {
          priorVersions = change.versions.map((candidate) =>
            candidate.state === 'active'
              ? { ...candidate, state: 'superseded' as const }
              : candidate,
          );
          submitDetail = `方案 v${version.version} 重新冻结，网络、系统、安全、业务意见按新版本重走`;
        }
      } else if (change.status === 'resubmit_required') {
        submitDetail = `方案 v${version.version} 重新冻结，网络、系统、安全、业务意见按新版本重走`;
      } else {
        submitDetail = `方案 v${version.version} 冻结后进入网络、系统、安全、业务顺序会签`;
      }

      const isResubmission = change.versions.length > 0;
      return touch({
        ...change,
        status: 'submitted',
        approvals,
        versions: [version, ...priorVersions],
        audit: [
          createAudit(isResubmission ? '重新提交会签' : '提交审批', submitDetail),
          ...change.audit,
        ],
      });
    }),
  })),
  on(ChangeRequestActions.approveStage, (state, { id, stage, approver, comment }) => ({
    ...state,
    changes: state.changes.map((change) => {
      if (change.id !== id || nextPendingStage(change) !== stage) {
        return change;
      }

      const approvals = change.approvals.map((approval) =>
        approval.stage === stage
          ? {
              ...approval,
              state: 'approved' as const,
              approver,
              comment,
              decidedAt: new Date().toISOString(),
            }
          : approval,
      );
      const allApproved = approvals.every((approval) => approval.state === 'approved');

      return touch({
        ...change,
        status: allApproved ? 'approved' : 'submitted',
        approvals,
        versions: syncActiveVersionApprovals(change, approvals),
        audit: [
          createAudit(
            '阶段会签',
            `${stage} 已由 ${approver} 批准 v${change.versions[0]?.version ?? 1}：${comment}`,
          ),
          ...change.audit,
        ],
      });
    }),
  })),
  on(ChangeRequestActions.rejectStage, (state, { id, stage, approver, comment }) => ({
    ...state,
    changes: state.changes.map((change) => {
      if (change.id !== id) {
        return change;
      }

      const approvals = change.approvals.map((approval) =>
        approval.stage === stage
          ? {
              ...approval,
              state: 'rejected' as const,
              approver,
              comment,
              decidedAt: new Date().toISOString(),
            }
          : approval,
      );

      return touch({
        ...change,
        status: 'rejected',
        approvals,
        versions: syncActiveVersionApprovals(change, approvals),
        audit: [
          createAudit(
            '审批退回',
            `${stage} 由 ${approver} 退回 v${change.versions[0]?.version ?? 1}：${comment}`,
          ),
          ...change.audit,
        ],
      });
    }),
  })),
  on(ChangeRequestActions.startExecution, (state, { id }) => ({
    ...state,
    changes: state.changes.map((change) => {
      if (change.id !== id || change.status !== 'approved') {
        return change;
      }
      const active = getActiveVersion(change);
      if (!active) {
        return change;
      }

      const frozen = approvalsFrozen(change.approvals);
      return touch({
        ...change,
        status: 'executing',
        executingVersion: active.version,
        approvals: frozen,
        versions: change.versions.map((version) =>
          version.state === 'active'
            ? {
                ...version,
                state: 'superseded',
                approvals: approvalsFrozen(version.approvals),
              }
            : version,
        ),
        audit: [
          createAudit(
            '开始执行',
            `按冻结版本 v${active.version} 执行，审批记录已冻结，执行页只读该版本`,
          ),
          ...change.audit,
        ],
      });
    }),
  })),
  on(ChangeRequestActions.toggleStep, (state, { id, stepId }) => ({
    ...state,
    changes: state.changes.map((change) => {
      if (change.id !== id || change.status !== 'executing') {
        return change;
      }

      const toggle = (steps: ChangeRequest['steps']) =>
        steps.map((step) =>
          step.id === stepId
            ? {
                ...step,
                completed: !step.completed,
                completedAt: step.completed ? undefined : new Date().toISOString(),
              }
            : step,
        );

      return touch({
        ...change,
        steps: toggle(change.steps),
        versions: change.versions.map((version) =>
          version.version === change.executingVersion
            ? { ...version, steps: toggle(version.steps) }
            : version,
        ),
      });
    }),
  })),
  on(ChangeRequestActions.recordDeviation, (state, { id, deviation }) => ({
    ...state,
    changes: state.changes.map((change) =>
      change.id === id
        ? touch({
            ...change,
            deviations: [deviation, ...change.deviations],
            audit: [
              createAudit('记录执行偏离', `${deviation.owner}：${deviation.description}`),
              ...change.audit,
            ],
          })
        : change,
    ),
  })),
  on(ChangeRequestActions.completeExecution, (state, { id, result, note }) => ({
    ...state,
    changes: state.changes.map((change) =>
      change.id === id && change.status === 'executing'
        ? touch({
            ...change,
            status: result,
            audit: [
              createAudit(result === 'completed' ? '执行完成' : '执行回滚', note),
              ...change.audit,
            ],
          })
        : change,
    ),
  })),
);

function approvalsFrozen(approvals: ApprovalRecord[]): ApprovalRecord[] {
  return approvals.map((approval) => ({ ...approval, state: 'frozen' as const }));
}
