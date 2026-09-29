import { createReducer, on } from '@ngrx/store';
import {
  ApprovalRecord,
  ApprovalStage,
  ChangeRequest,
  APPROVAL_ORDER,
  buildSnapshot,
  createAudit,
  createPlanVersion,
  diffVersions,
  getCurrentVersion,
  snapshotFingerprint,
  summarizeDiffReasons,
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

/**
 * 会签中或已批准的方案一旦参与对象、窗口或步骤摘要发生变化：
 * 旧版本及其全部签字失效，方案回到“待重新提交”。
 */
function invalidateCurrentVersion(change: ChangeRequest, next: ChangeRequest): ChangeRequest {
  const current = getCurrentVersion(change);
  if (!current || !['in_review', 'approved', 'rejected'].includes(current.state)) {
    return next;
  }

  const diff = diffVersions(current, buildSnapshot(next));
  // 纳入版本固定的内容没有变化（只改了标题、风险、值守等），旧签字继续有效。
  if (!diff.changed) {
    return next;
  }

  const reason = summarizeDiffReasons(diff);
  const invalidatedAt = new Date().toISOString();
  const invalidateApproval = (approval: ApprovalRecord): ApprovalRecord =>
    approval.state === 'pending'
      ? { ...approval, state: 'invalidated' }
      : approval;

  const versions = next.versions.map((version) =>
    version.version === current.version
      ? {
          ...version,
          state: 'invalidated' as const,
          invalidatedReason: reason,
          invalidatedAt,
          // 原始意见保留在版本上，仅把尚未签署的席位标记为随版本失效。
          approvals: version.approvals.map(invalidateApproval),
        }
      : version,
  );

  return {
    ...next,
    status: 'resubmit',
    currentVersion: null,
    versions,
    approvals: current.approvals.map(invalidateApproval),
    audit: [
      createAudit('版本失效', `${reason}，第 ${current.version} 版签字全部失效，需重新提交会签。`),
      ...next.audit,
    ],
  };
}

export const changeRequestReducer = createReducer(
  initialChangeRequestState,
  on(ChangeRequestActions.loadChanges, (state) => ({ ...state, loading: true, error: null })),
  on(ChangeRequestActions.loadChangesSuccess, (state, { changes }) => ({
    ...state,
    changes,
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
        versions: [],
        currentVersion: null,
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
      const saved = touch({
        ...change,
        // 历史版本和有效版本指针只能由送审/失效流转改变，编辑工作副本不触碰它们。
        versions: item.versions,
        currentVersion: item.currentVersion,
        audit: [
          createAudit('保存变更方案', '更新资源、步骤或窗口信息'),
          ...change.audit,
        ],
      });
      return invalidateCurrentVersion(item, saved);
    }),
  })),
  on(ChangeRequestActions.deleteDraft, (state, { id }) => ({
    ...state,
    changes: state.changes.filter((change) => change.id !== id || change.status !== 'draft'),
  })),
  on(ChangeRequestActions.submitForReview, (state, { id }) => ({
    ...state,
    changes: state.changes.map((change) => {
      if (change.id !== id || !['draft', 'rejected', 'resubmit'].includes(change.status)) {
        return change;
      }

      const existing = getCurrentVersion(change);
      const reuseRejected =
        change.status === 'rejected' &&
        existing?.state === 'rejected' &&
        snapshotFingerprint({
          resources: existing.resources,
          window: existing.window,
          steps: existing.steps,
        }) === snapshotFingerprint(buildSnapshot(change));

      let versions = change.versions;
      let versionNumber: number;
      let approvals: ApprovalRecord[];

      if (reuseRejected && existing) {
        // 被退回后未改动固定内容即重新提交：沿用原版本，网络/系统/安全/业务按新版本重走。
        versionNumber = existing.version;
        approvals = APPROVAL_ORDER.map((stage) => ({ stage, state: 'pending' as const }));
        versions = change.versions.map((version) =>
          version.version === existing.version
            ? { ...version, state: 'in_review' as const, approvals }
            : version,
        );
      } else {
        // 草稿首次送审，或方案修改后重新送审：固定为新的不可变版本。
        const version = createPlanVersion(change, change.owner || '当前用户');
        versions = [...change.versions, version];
        versionNumber = version.version;
        approvals = version.approvals;
      }

      // 新送审版本的步骤尚未执行，清空工作副本上的历史勾选。
      const steps = change.steps.map((step) => ({
        ...step,
        completed: false,
        completedAt: undefined,
      }));

      return touch({
        ...change,
        steps,
        status: 'submitted',
        versions,
        currentVersion: versionNumber,
        approvals,
        audit: [
          createAudit(
            '提交审批',
            reuseRejected
              ? `第 ${versionNumber} 版重新进入会签，网络、系统、安全、业务顺序重走。`
              : `第 ${versionNumber} 版方案冻结送审，记录参与对象、窗口与步骤摘要。`,
          ),
          ...change.audit,
        ],
      });
    }),
  })),
  on(ChangeRequestActions.approveStage, (state, { id, stage, approver, comment }) => ({
    ...state,
    changes: state.changes.map((change) => {
      const current = getCurrentVersion(change);
      if (change.id !== id || change.status !== 'submitted' || current?.state !== 'in_review') {
        return change;
      }

      const nextPending = APPROVAL_ORDER.find((candidate) =>
        current.approvals.some(
          (approval) => approval.stage === candidate && approval.state === 'pending',
        ),
      );
      if (nextPending !== stage) {
        return change;
      }

      const decidedAt = new Date().toISOString();
      const withDecision = (approval: ApprovalRecord): ApprovalRecord =>
        approval.stage === stage
          ? { ...approval, state: 'approved', approver, comment, decidedAt }
          : approval;

      const versionApprovals = current.approvals.map(withDecision);
      const allApproved = versionApprovals.every((approval) => approval.state === 'approved');
      const versions = change.versions.map((version) =>
        version.version === current.version
          ? {
              ...version,
              state: allApproved ? ('approved' as const) : ('in_review' as const),
              approvals: versionApprovals,
            }
          : version,
      );

      return touch({
        ...change,
        status: allApproved ? 'approved' : 'submitted',
        versions,
        approvals: versionApprovals,
        audit: [createAudit('阶段会签', `第 ${current.version} 版 ${stage} 已由 ${approver} 批准：${comment}`), ...change.audit],
      });
    }),
  })),
  on(ChangeRequestActions.rejectStage, (state, { id, stage, approver, comment }) => ({
    ...state,
    changes: state.changes.map((change) => {
      const current = getCurrentVersion(change);
      if (change.id !== id || change.status !== 'submitted' || current?.state !== 'in_review') {
        return change;
      }

      const decidedAt = new Date().toISOString();
      const versionApprovals = current.approvals.map((approval) =>
        approval.stage === stage
          ? { ...approval, state: 'rejected' as const, approver, comment, decidedAt }
          : approval,
      );
      const versions = change.versions.map((version) =>
        version.version === current.version
          ? { ...version, state: 'rejected' as const, approvals: versionApprovals }
          : version,
      );

      return touch({
        ...change,
        status: 'rejected',
        versions,
        approvals: versionApprovals,
        audit: [
          createAudit('审批退回', `第 ${current.version} 版 ${stage} 由 ${approver} 退回：${comment}`),
          ...change.audit,
        ],
      });
    }),
  })),
  on(ChangeRequestActions.startExecution, (state, { id }) => ({
    ...state,
    changes: state.changes.map((change) => {
      const current = getCurrentVersion(change);
      // 只有当前有效且全部会签通过的版本才能开始执行；失效版本不可执行。
      if (change.id !== id || change.status !== 'approved' || current?.state !== 'approved') {
        return change;
      }

      const versions = change.versions.map((version) =>
        version.version === current.version
          ? {
              ...version,
              state: 'frozen' as const,
              approvals: version.approvals.map((approval) => ({ ...approval, state: 'frozen' as const })),
            }
          : version,
      );
      const frozenApprovals = versions.find(
        (version) => version.version === current.version,
      )!.approvals;

      return touch({
        ...change,
        status: 'executing',
        versions,
        approvals: frozenApprovals,
        audit: [
          createAudit('开始执行', `按第 ${current.version} 版冻结快照执行，审批记录已冻结。`),
          ...change.audit,
        ],
      });
    }),
  })),
  on(ChangeRequestActions.toggleStep, (state, { id, stepId }) => ({
    ...state,
    changes: state.changes.map((change) => {
      const current = getCurrentVersion(change);
      // 执行页只读取当前有效版本，失效版本的步骤不能勾选。
      if (change.id !== id || change.status !== 'executing' || current?.state !== 'frozen') {
        return change;
      }
      const belongsToVersion = current.steps.some((step) => step.id === stepId);
      if (!belongsToVersion) {
        return change;
      }
      return touch({
        ...change,
        steps: change.steps.map((step) =>
          step.id === stepId
            ? {
                ...step,
                completed: !step.completed,
                completedAt: step.completed ? undefined : new Date().toISOString(),
              }
            : step,
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
              createAudit(
                result === 'completed' ? '执行完成' : '执行回滚',
                `第 ${change.currentVersion ?? '-'} 版：${note}`,
              ),
              ...change.audit,
            ],
          })
        : change,
    ),
  })),
);
