import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClarityModule } from '@clr/angular';
import {
  ApprovalRecord,
  ChangeRequest,
  DIFF_AREA_LABELS,
  PlanVersion,
  PlanVersionDiff,
  STAGE_LABELS,
  diffPlanVersions,
} from '../../models/change-request.model';

interface VersionOption {
  value: string;
  label: string;
}

const WORKING_COPY = 'working';

@Component({
  selector: 'app-version-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FormsModule, ClarityModule],
  template: `
    <section class="version-layout">
      <div class="version-timeline">
        <h3>送审版本</h3>
        <p class="hint">每个版本冻结当时的参与对象、窗口、步骤摘要和四方原意见。</p>

        <article
          class="version-card working"
          [class.outdated]="!!activeVersion()"
          [class.selected]="selectedLeft() === 'working' || selectedRight() === 'working'"
        >
          <div class="card-head">
            <strong>工作副本（未冻结）</strong>
            <span class="badge working-badge">编辑中</span>
          </div>
          <p>当前页面上正在编辑的方案内容，保存后即成为此副本。</p>
          <small>
            {{
              activeVersion() ? '与当前有效版本存在差异时保存会使旧签字失效' : '尚未冻结为送审版本'
            }}
          </small>
        </article>

        @for (version of change().versions; track version.version) {
          <article
            class="version-card"
            [class]="versionClass(version)"
            [class.selected]="
              selectedLeft() === versionKey(version) || selectedRight() === versionKey(version)
            "
            [class.executed]="change().executingVersion === version.version"
          >
            <div class="card-head">
              <strong>v{{ version.version }}</strong>
              <span class="badge" [class]="versionClass(version)">{{ versionBadge(version) }}</span>
              @if (change().executingVersion === version.version) {
                <span class="badge executing-badge">执行版本</span>
              }
            </div>
            <p class="meta">
              送审 {{ version.submittedAt | date: 'yyyy-MM-dd HH:mm' }} · {{ version.submittedBy }}
            </p>
            @if (version.state === 'invalidated') {
              <p class="invalidated-note">
                因{{ invalidatedAreasText(version) }}变更，签字已于
                {{ version.invalidatedAt | date: 'MM-dd HH:mm' }} 失效
              </p>
            }
            <ul class="version-approvals">
              @for (approval of version.approvals; track approval.stage) {
                <li [class]="approval.state">
                  <span>{{ stageLabel(approval.stage) }}</span>
                  <strong>{{ approvalStateText(approval.state) }}</strong>
                  @if (approval.approver) {
                    <small
                      >{{ approval.approver }} ·
                      {{ approval.decidedAt | date: 'MM-dd HH:mm' }}</small
                    >
                  }
                  @if (approval.comment) {
                    <p class="opinion">“{{ approval.comment }}”</p>
                  }
                </li>
              }
            </ul>
          </article>
        } @empty {
          <p class="empty">该变更还没有送审版本。</p>
        }
      </div>

      <div class="version-diff">
        <h3>前后差异</h3>
        <p class="hint">选择任意两个版本（或工作副本）比较参与对象、窗口与步骤摘要。</p>

        <div class="diff-pickers">
          <clr-select-container>
            <label>旧版本</label>
            <select
              clrSelect
              [ngModel]="selectedLeft()"
              (ngModelChange)="leftSelection.set($event)"
            >
              @for (option of options(); track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </clr-select-container>
          <clr-select-container>
            <label>新版本</label>
            <select
              clrSelect
              [ngModel]="selectedRight()"
              (ngModelChange)="rightSelection.set($event)"
            >
              @for (option of options(); track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </clr-select-container>
        </div>

        @if (selectionError()) {
          <p class="empty">{{ selectionError() }}</p>
        } @else if (currentDiff(); as diff) {
          @if (diff.areas.length === 0) {
            <p class="diff-clear">两个版本的参与对象、窗口和步骤摘要完全一致。</p>
          } @else {
            <div class="area-chips">
              @for (area of diff.areas; track area) {
                <span class="area-chip">{{ areaLabel(area) }}有变更</span>
              }
            </div>
          }

          @for (group of diffGroups(diff); track group.title) {
            <section class="diff-group">
              <h4>{{ group.title }}</h4>
              @for (item of group.items; track item.label) {
                <div class="diff-row">
                  <span class="diff-label">{{ item.label }}</span>
                  <div class="diff-values">
                    <p class="before"><span>旧</span>{{ item.before || '—' }}</p>
                    <p class="after"><span>新</span>{{ item.after || '—' }}</p>
                  </div>
                </div>
              }
            </section>
          }
        }
      </div>
    </section>
  `,
  styles: [
    `
      .version-layout {
        display: grid;
        grid-template-columns: minmax(320px, 0.9fr) minmax(380px, 1.1fr);
        gap: 18px;
        align-items: start;
      }

      .version-timeline,
      .version-diff {
        padding: 18px;
        border: 1px solid #d7d7d7;
        background: #fff;
      }

      h3 {
        margin: 0;
        font-size: 16px;
      }

      .hint {
        margin: 6px 0 16px;
        color: #777;
        font-size: 12px;
      }

      .version-card {
        margin-bottom: 12px;
        padding: 14px;
        border: 1px solid #d9d9d9;
        border-left: 3px solid #9d9d9d;
        background: #fafafa;
      }

      .version-card.selected {
        outline: 2px solid #266c91;
        outline-offset: 1px;
      }

      .version-card.active {
        border-left-color: #2f7d4a;
        background: #f3f9f5;
      }

      .version-card.invalidated {
        border-left-color: #c21d00;
        background: #fdf2ef;
      }

      .version-card.superseded {
        border-left-color: #8a8a8a;
      }

      .version-card.executed {
        box-shadow: inset 0 0 0 1px #266c91;
      }

      .version-card.working {
        border-left-color: #266c91;
        background: #f2f7fa;
      }

      .version-card.working.outdated {
        border-left-color: #d0a251;
      }

      .card-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .badge {
        padding: 1px 7px;
        border: 1px solid #9d9d9d;
        background: #eee;
        color: #555;
        font-size: 10px;
      }

      .badge.active {
        border-color: #4b8d65;
        background: #e8f5ed;
        color: #245f3d;
      }

      .badge.invalidated {
        border-color: #d58d7e;
        background: #fbece8;
        color: #8e260f;
      }

      .badge.superseded {
        border-color: #b0b0b0;
        background: #f1f1f1;
        color: #666;
      }

      .working-badge,
      .executing-badge {
        border-color: #266c91;
        background: #eaf4f9;
        color: #1d5877;
      }

      .meta,
      .version-card p {
        margin: 6px 0 0;
        color: #666;
        font-size: 12px;
      }

      .invalidated-note {
        color: #8e260f !important;
      }

      .version-approvals {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        margin: 12px 0 0;
        padding: 0;
        list-style: none;
      }

      .version-approvals li {
        padding: 8px 10px;
        border: 1px solid #e1e1e1;
        background: #fff;
      }

      .version-approvals li span,
      .version-approvals li strong,
      .version-approvals li small {
        display: block;
      }

      .version-approvals li span {
        color: #555;
        font-size: 11px;
      }

      .version-approvals li strong {
        margin-top: 2px;
        font-size: 12px;
      }

      .version-approvals li.approved strong,
      .version-approvals li.frozen strong {
        color: #245f3d;
      }

      .version-approvals li.rejected strong {
        color: #8e260f;
      }

      .version-approvals small {
        margin-top: 2px;
        color: #888;
        font-size: 10px;
      }

      .opinion {
        margin: 6px 0 0 !important;
        color: #444 !important;
        font-size: 11px !important;
        font-style: italic;
      }

      .diff-pickers {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        margin-bottom: 14px;
      }

      .area-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 14px;
      }

      .area-chip {
        padding: 3px 10px;
        background: #fbece8;
        color: #8e260f;
        font-size: 11px;
      }

      .diff-clear {
        margin: 0 0 12px;
        padding: 12px;
        border-left: 3px solid #4b8d65;
        background: #edf7f0;
        color: #245f3d;
        font-size: 12px;
      }

      .diff-group {
        margin-top: 14px;
      }

      .diff-group h4 {
        margin: 0 0 8px;
        font-size: 13px;
      }

      .diff-row {
        display: grid;
        grid-template-columns: 150px 1fr;
        gap: 10px;
        padding: 10px 0;
        border-bottom: 1px solid #ececec;
      }

      .diff-label {
        color: #555;
        font-size: 12px;
      }

      .diff-values {
        display: grid;
        gap: 4px;
      }

      .diff-values p {
        display: flex;
        gap: 8px;
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        word-break: break-all;
      }

      .diff-values p span {
        flex: 0 0 20px;
        font-weight: 700;
      }

      .diff-values .before {
        color: #8e260f;
      }

      .diff-values .after {
        color: #245f3d;
      }

      .empty {
        color: #777;
        font-size: 12px;
      }

      @media (max-width: 960px) {
        .version-layout {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class VersionHistoryComponent {
  readonly change = input.required<ChangeRequest>();

  readonly leftSelection = signal<string | null>(null);
  readonly rightSelection = signal<string | null>(null);

  readonly options = computed<VersionOption[]>(() => {
    const change = this.change();
    const versionOptions = change.versions.map((version) => ({
      value: this.versionKey(version),
      label: `v${version.version}（${this.versionBadge(version)}）`,
    }));
    return [{ value: WORKING_COPY, label: '工作副本（当前编辑内容）' }, ...versionOptions];
  });

  readonly activeVersion = computed(() =>
    ['submitted', 'approved'].includes(this.change().status)
      ? this.change().versions.find((version) => version.state === 'active')
      : undefined,
  );

  /** 默认比较：当前工作副本 vs 最近一个失效版本；否则工作副本 vs 最新冻结版本 */
  readonly selectedLeft = computed(() => this.leftSelection() ?? WORKING_COPY);
  readonly selectedRight = computed(() => {
    if (this.rightSelection()) {
      return this.rightSelection();
    }
    const change = this.change();
    const latestInvalidated = change.versions.find((version) => version.state === 'invalidated');
    return latestInvalidated
      ? this.versionKey(latestInvalidated)
      : change.versions[0]
        ? this.versionKey(change.versions[0])
        : WORKING_COPY;
  });

  readonly selectionError = computed(() =>
    this.selectedLeft() === this.selectedRight() ? '请选择两个不同的版本进行比较。' : '',
  );

  readonly currentDiff = computed<PlanVersionDiff | null>(() => {
    const left = this.selectedLeft();
    const right = this.selectedRight();
    if (!left || !right || left === right) {
      return null;
    }
    return diffPlanVersions(this.resolve(left), this.resolve(right));
  });

  private resolve(value: string): Pick<ChangeRequest, 'resources' | 'window' | 'steps'> {
    if (value === WORKING_COPY) {
      return this.change();
    }
    const version = this.change().versions.find((item) => this.versionKey(item) === value);
    return version ?? this.change();
  }

  diffGroups(diff: PlanVersionDiff): Array<{ title: string; items: PlanVersionDiff['resources'] }> {
    return [
      { title: '参与对象', items: diff.resources },
      { title: '窗口', items: diff.window },
      { title: '步骤摘要', items: diff.steps },
    ].filter((group) => group.items.length > 0);
  }

  versionKey(version: PlanVersion): string {
    return `v${version.version}`;
  }

  invalidatedAreasText(version: PlanVersion): string {
    return version.invalidatedAreas.map((area) => DIFF_AREA_LABELS[area]).join('、') || '内容';
  }

  areaLabel(area: keyof typeof DIFF_AREA_LABELS): string {
    return DIFF_AREA_LABELS[area];
  }

  versionStateText(state: PlanVersion['state']): string {
    return { active: '会签中/有效', invalidated: '已失效', superseded: '已冻结/归档' }[state];
  }

  /** 卡片样式类：已退回状态下 active 快照不再呈现为有效 */
  versionClass(version: PlanVersion): PlanVersion['state'] {
    if (version.state === 'active' && !['submitted', 'approved'].includes(this.change().status)) {
      return 'superseded';
    }
    return version.state;
  }

  versionBadge(version: PlanVersion): string {
    if (version.state === 'active' && this.change().status === 'rejected') {
      return '已退回待重送';
    }
    return this.versionStateText(version.state);
  }

  stageLabel(stage: ApprovalRecord['stage']): string {
    return STAGE_LABELS[stage];
  }

  approvalStateText(state: ApprovalRecord['state']): string {
    return { pending: '等待签署', approved: '已批准', rejected: '已退回', frozen: '已冻结' }[state];
  }
}
