import { DatePipe, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ClarityModule } from '@clr/angular';
import { Store } from '@ngrx/store';
import { AuditTrailComponent } from '../../components/audit-trail/audit-trail.component';
import { DependencyGraphComponent } from '../../components/dependency-graph/dependency-graph.component';
import { ValidationPanelComponent } from '../../components/validation-panel/validation-panel.component';
import { VersionHistoryComponent } from '../../components/version-history/version-history.component';
import { WindowGanttComponent } from '../../components/window-gantt/window-gantt.component';
import {
  ApprovalStage,
  ChangeRequest,
  ChangeResource,
  ChangeStep,
  DIFF_AREA_LABELS,
  DeviationRecord,
  PHASE_LABELS,
  RESOURCE_LABELS,
  RISK_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  StepPhase,
  diffPlanVersions,
  getActiveVersion,
  getEffectivePlan,
  validateChange,
} from '../../models/change-request.model';
import { ChangeRequestService } from '../../services/change-request.service';
import { ChangeRequestActions } from '../../store/change-request.actions';
import { selectAllChanges } from '../../store/change-request.selectors';

type DetailTab =
  'overview' | 'dependency' | 'window' | 'execution' | 'approval' | 'versions' | 'audit';

@Component({
  selector: 'app-change-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    NgClass,
    FormsModule,
    RouterLink,
    ClarityModule,
    AuditTrailComponent,
    DependencyGraphComponent,
    ValidationPanelComponent,
    VersionHistoryComponent,
    WindowGanttComponent,
  ],
  template: `
    @if (change(); as item) {
      <section class="detail-heading">
        <div class="heading-main">
          <a routerLink="/" class="back-link">返回变更队列</a>
          <div class="title-row">
            <div>
              <span class="change-id">{{ item.id }}</span>
              <h1>{{ item.title }}</h1>
            </div>
            <span class="status" [class]="item.status">{{ statusLabel(item.status) }}</span>
            @if (activeVersion(); as version) {
              <span class="version-chip">当前有效 v{{ version.version }}</span>
            } @else if (item.executingVersion) {
              <span class="version-chip executing">执行锁定 v{{ item.executingVersion }}</span>
            }
          </div>
          <p>{{ item.summary || '尚未填写变更摘要。' }}</p>
          @if (item.status === 'resubmit_required') {
            <div class="resubmit-banner">
              <strong>当前编辑内容尚未重新送审</strong>
              <span>
                已冻结版本的{{
                  latestInvalidatedAreas(item)
                }}发生变化，旧签字全部失效；请核对方案后到
                <button type="button" class="link-btn" (click)="selectedTab.set('approval')">
                  审批会签
                </button>
                重新提交，四方意见按新版本重走。
              </span>
            </div>
          }
        </div>
        <div class="heading-meta">
          <div>
            <span>负责人</span>
            <strong>{{ item.owner }}</strong>
          </div>
          <div>
            <span>风险</span>
            <strong>{{ riskLabel(item.risk) }}</strong>
          </div>
          <div>
            <span>更新</span>
            <strong>{{ item.updatedAt | date: 'MM-dd HH:mm' }}</strong>
          </div>
        </div>
      </section>

      <nav class="tab-nav" aria-label="变更详情">
        @for (tab of tabs; track tab.id) {
          <button
            type="button"
            [class.active]="selectedTab() === tab.id"
            (click)="selectedTab.set(tab.id)"
          >
            {{ tab.label }}
            @if (tab.id === 'approval' && pendingStage(); as stage) {
              <span class="nav-badge">{{ stageLabel(stage) }}</span>
            }
          </button>
        }
      </nav>

      @switch (selectedTab()) {
        @case ('overview') {
          <div class="content-grid">
            <section class="surface">
              <div class="surface-heading">
                <div>
                  <h2>方案概览</h2>
                  <span>影响范围、值班和执行边界</span>
                </div>
                <button
                  class="btn btn-sm"
                  type="button"
                  (click)="editing() ? cancelEdit() : beginEdit()"
                  [disabled]="item.status === 'executing' || item.status === 'completed'"
                >
                  {{ editing() ? '取消编辑' : '编辑方案' }}
                </button>
              </div>

              @if (editing()) {
                <div class="edit-form">
                  <clr-input-container>
                    <label>标题</label>
                    <input
                      clrInput
                      [ngModel]="draft()?.title"
                      (ngModelChange)="updateDraft('title', $event)"
                    />
                  </clr-input-container>
                  <clr-textarea-container>
                    <label>摘要</label>
                    <textarea
                      clrTextarea
                      rows="3"
                      [ngModel]="draft()?.summary"
                      (ngModelChange)="updateDraft('summary', $event)"
                    ></textarea>
                  </clr-textarea-container>
                  <div class="edit-grid">
                    <clr-input-container>
                      <label>窗口开始</label>
                      <input
                        clrInput
                        type="datetime-local"
                        [ngModel]="draft()?.window?.start"
                        (ngModelChange)="updateDraftWindow('start', $event)"
                      />
                    </clr-input-container>
                    <clr-input-container>
                      <label>窗口结束</label>
                      <input
                        clrInput
                        type="datetime-local"
                        [ngModel]="draft()?.window?.end"
                        (ngModelChange)="updateDraftWindow('end', $event)"
                      />
                    </clr-input-container>
                    <clr-input-container>
                      <label>观察窗口（分钟）</label>
                      <input
                        clrNumberInput
                        type="number"
                        [ngModel]="draft()?.window?.observationWindowMinutes"
                        (ngModelChange)="updateObservation($event)"
                      />
                    </clr-input-container>
                  </div>

                  <div class="edit-block">
                    <h3>参与对象（机柜、依赖等）</h3>
                    <p class="block-hint">
                      会签中或已批准时改动对象，将使旧签字失效并回到待重新提交。
                    </p>
                    <div class="mini-form">
                      <clr-input-container>
                        <label>对象 ID</label>
                        <input
                          clrInput
                          [ngModel]="newResourceId()"
                          (ngModelChange)="newResourceId.set($event)"
                        />
                      </clr-input-container>
                      <clr-input-container>
                        <label>对象名称</label>
                        <input
                          clrInput
                          [ngModel]="newResourceName()"
                          (ngModelChange)="newResourceName.set($event)"
                        />
                      </clr-input-container>
                      <clr-select-container>
                        <label>类型</label>
                        <select
                          clrSelect
                          [ngModel]="newResourceType()"
                          (ngModelChange)="newResourceType.set($event)"
                        >
                          @for (type of resourceTypes; track type) {
                            <option [value]="type">{{ resourceLabel(type) }}</option>
                          }
                        </select>
                      </clr-select-container>
                      <clr-input-container>
                        <label>依赖 ID（逗号分隔）</label>
                        <input
                          clrInput
                          [ngModel]="newDependencyText()"
                          (ngModelChange)="newDependencyText.set($event)"
                        />
                      </clr-input-container>
                      <button class="btn btn-sm" type="button" (click)="addDraftResource()">
                        添加对象
                      </button>
                    </div>
                    <ul class="edit-list">
                      @for (resource of draft()?.resources; track resource.id) {
                        <li>
                          <div class="edit-item-main">
                            <strong>{{ resource.name }}</strong>
                            <span
                              >{{ resource.id }} · {{ resourceLabel(resource.type) }} · 依赖
                              {{ resource.dependencies.join('、') || '无' }}</span
                            >
                          </div>
                          <label class="inline-check">
                            <input
                              type="checkbox"
                              [checked]="resource.critical"
                              (change)="toggleDraftResourceCritical(resource.id)"
                            />
                            关键
                          </label>
                          <button
                            class="btn btn-sm btn-link"
                            type="button"
                            (click)="removeDraftResource(resource.id)"
                          >
                            移除
                          </button>
                        </li>
                      }
                    </ul>
                  </div>

                  <div class="edit-block">
                    <h3>执行与回滚步骤摘要</h3>
                    <p class="block-hint">步骤标题、责任人或命令变更均会触发旧签字失效。</p>
                    <div class="mini-form step-mini">
                      <clr-input-container>
                        <label>步骤名称</label>
                        <input
                          clrInput
                          [ngModel]="newStepTitle()"
                          (ngModelChange)="newStepTitle.set($event)"
                        />
                      </clr-input-container>
                      <clr-select-container>
                        <label>阶段</label>
                        <select
                          clrSelect
                          [ngModel]="newStepPhase()"
                          (ngModelChange)="newStepPhase.set($event)"
                        >
                          <option value="prepare">准备</option>
                          <option value="execute">执行</option>
                          <option value="verify">验证</option>
                          <option value="rollback">回滚</option>
                        </select>
                      </clr-select-container>
                      <clr-input-container>
                        <label>责任人</label>
                        <input
                          clrInput
                          [ngModel]="newStepOwner()"
                          (ngModelChange)="newStepOwner.set($event)"
                        />
                      </clr-input-container>
                      <clr-input-container>
                        <label>命令或操作</label>
                        <input
                          clrInput
                          [ngModel]="newStepCommand()"
                          (ngModelChange)="newStepCommand.set($event)"
                        />
                      </clr-input-container>
                      <button class="btn btn-sm" type="button" (click)="addDraftStep()">
                        添加步骤
                      </button>
                    </div>
                    <ul class="edit-list">
                      @for (step of draft()?.steps; track step.id) {
                        <li>
                          <div class="edit-item-main">
                            <strong>{{ phaseLabel(step.phase) }}｜{{ step.title }}</strong>
                            <span
                              >{{ step.owner || '未指定责任人' }} ·
                              {{ step.command || '缺少命令' }}</span
                            >
                          </div>
                          <button
                            class="btn btn-sm btn-link"
                            type="button"
                            (click)="removeDraftStep(step.id)"
                          >
                            移除
                          </button>
                        </li>
                      }
                    </ul>
                  </div>

                  @if (pendingMaterialDiff(); as diff) {
                    <div class="invalid-warning">
                      <strong>保存后当前版本签字将失效</strong>
                      <p>
                        相对当前有效版本，以下内容已变化：
                        {{ diff.areas.map(areaLabel).join('、') }}。保存后方案回到待重新提交，
                        网络、系统、安全、业务意见需按新版本全部重签；历史版本与原意见仍可在“版本与差异”中查看。
                      </p>
                    </div>
                  }
                  <div class="edit-actions">
                    <button class="btn btn-primary" type="button" (click)="saveEdit()">
                      保存方案
                    </button>
                  </div>
                </div>
              } @else {
                <dl class="facts">
                  <div>
                    <dt>执行窗口</dt>
                    <dd>
                      {{ item.window.start | date: 'yyyy-MM-dd HH:mm' }} 至
                      {{ item.window.end | date: 'yyyy-MM-dd HH:mm' }}
                    </dd>
                  </div>
                  <div>
                    <dt>观察窗口</dt>
                    <dd>{{ item.window.observationWindowMinutes }} 分钟</dd>
                  </div>
                  <div>
                    <dt>值守人员</dt>
                    <dd>{{ item.onCall.join('、') }}</dd>
                  </div>
                  <div>
                    <dt>当前门禁</dt>
                    <dd>
                      {{ pendingStage() ? stageLabel(pendingStage()!) + '待会签' : approvalGate() }}
                    </dd>
                  </div>
                  <div>
                    <dt>有效送审版本</dt>
                    <dd>{{ effectiveVersionLabel(item) }}</dd>
                  </div>
                </dl>
              }
            </section>

            <app-validation-panel [change]="item" [allChanges]="changes()" />

            <section class="surface span-2">
              <div class="surface-heading">
                <div>
                  <h2>资源清单</h2>
                  <span>{{ item.resources.length }} 个对象，明确关键资源依赖</span>
                </div>
              </div>
              <div class="resource-table">
                @for (resource of item.resources; track resource.id) {
                  <article>
                    <span class="type">{{ resourceLabel(resource.type) }}</span>
                    <div>
                      <strong>{{ resource.name }}</strong>
                      <small>{{ resource.id }}</small>
                    </div>
                    <span>{{ resource.critical ? '关键资源' : '一般资源' }}</span>
                    <span>依赖 {{ resource.dependencies.length }} 项</span>
                  </article>
                } @empty {
                  <p class="empty">未配置资源。</p>
                }
              </div>
            </section>
          </div>
        }

        @case ('dependency') {
          <section class="surface">
            <div class="surface-heading">
              <div>
                <h2>依赖关系图</h2>
                <span>虚线表示依赖资源未纳入本次影响范围</span>
              </div>
            </div>
            <app-dependency-graph [change]="item" />
          </section>
        }

        @case ('window') {
          <section class="surface">
            <div class="surface-heading">
              <div>
                <h2>窗口与资源冲突</h2>
                <span>按 09-29 至 10-02 展示所有有效窗口</span>
              </div>
            </div>
            <app-window-gantt [changes]="changes()" [selectedId]="item.id" />
            <div class="conflict-notes">
              @for (issue of issues(); track issue.id) {
                @if (issue.code === 'WINDOW_CONFLICT') {
                  <article>
                    <strong>{{ issue.title }}</strong>
                    <p>{{ issue.detail }}</p>
                    <span>{{ issue.suggestedAction }}</span>
                  </article>
                }
              } @empty {
                <p class="empty">当前没有窗口冲突。</p>
              }
            </div>
          </section>
        }

        @case ('execution') {
          <div class="content-grid execution-grid">
            <section class="surface">
              <div class="surface-heading">
                <div>
                  <h2>执行步骤</h2>
                  <span>
                    执行页只读取当前有效版本
                    @if (effectivePlan(item); as plan) {
                      <strong>（v{{ plan.version }}）</strong>
                    }
                    ，逐项勾选保留时间戳
                  </span>
                </div>
                @if (item.status === 'approved' && effectivePlan(item)) {
                  <button class="btn btn-primary" type="button" (click)="startExecution()">
                    开始执行
                  </button>
                }
              </div>
              @if (item.status === 'resubmit_required') {
                <p class="invalid-warning">
                  方案内容已变更并回到待重新提交，当前没有可执行的有效版本；重新会签批准后方可执行。
                </p>
              }
              @if (effectivePlan(item); as plan) {
                <div class="step-list">
                  @for (step of stepsBy(plan); track step.id) {
                    <label class="step-row" [class.completed]="step.completed">
                      <input
                        type="checkbox"
                        [checked]="step.completed"
                        [disabled]="
                          item.status !== 'executing' || item.executingVersion !== plan.version
                        "
                        (change)="toggleStep(step.id)"
                      />
                      <span class="phase">{{ phaseLabel(step.phase) }}</span>
                      <div>
                        <strong>{{ step.title }}</strong>
                        <code>{{ step.command || '未填写命令' }}</code>
                      </div>
                      <span>{{ step.owner || '未指定' }}</span>
                    </label>
                  } @empty {
                    <p class="empty">该版本没有执行步骤。</p>
                  }
                </div>
              } @else {
                <p class="empty">当前没有有效版本，执行步骤不可勾选。</p>
              }
            </section>

            <section class="surface">
              <div class="surface-heading">
                <div>
                  <h2>实时执行记录</h2>
                  <span>记录偏离并明确继续、暂停或回滚</span>
                </div>
                <a
                  class="btn btn-sm"
                  href="https://logs.example.internal/change/{{ item.id }}"
                  target="_blank"
                  rel="noopener"
                >
                  打开实时日志
                </a>
              </div>
              @if (item.status === 'executing') {
                <div class="deviation-form">
                  <clr-textarea-container>
                    <label>偏离说明</label>
                    <textarea
                      clrTextarea
                      rows="3"
                      [ngModel]="deviationText()"
                      (ngModelChange)="deviationText.set($event)"
                      placeholder="描述实际执行与方案差异"
                    ></textarea>
                  </clr-textarea-container>
                  <div class="deviation-actions">
                    <clr-select-container>
                      <label>处置决定</label>
                      <select
                        clrSelect
                        [ngModel]="deviationDecision()"
                        (ngModelChange)="deviationDecision.set($event)"
                      >
                        <option value="continue">继续观察</option>
                        <option value="pause">暂停执行</option>
                        <option value="rollback">立即回滚</option>
                      </select>
                    </clr-select-container>
                    <button class="btn" type="button" (click)="recordDeviation()">记录偏离</button>
                  </div>
                </div>
                <div class="completion-actions">
                  <button class="btn" type="button" (click)="complete('rolled_back')">
                    判定回滚
                  </button>
                  <button class="btn btn-primary" type="button" (click)="complete('completed')">
                    执行完成
                  </button>
                </div>
              }
              <div class="deviation-list">
                @for (deviation of item.deviations; track deviation.id) {
                  <article>
                    <div>
                      <strong>{{ deviation.owner }}</strong>
                      <time>{{ deviation.recordedAt | date: 'MM-dd HH:mm' }}</time>
                    </div>
                    <p>{{ deviation.description }}</p>
                    <span>{{ decisionLabel(deviation.decision) }}</span>
                  </article>
                } @empty {
                  <p class="empty">尚无执行偏离。</p>
                }
              </div>
            </section>
          </div>
        }

        @case ('approval') {
          <div class="content-grid approval-grid">
            <section class="surface">
              <div class="surface-heading">
                <div>
                  <h2>顺序会签</h2>
                  <span>
                    必须按网络、系统、安全、业务顺序完成
                    @if (activeVersion(); as version) {
                      <strong>· 当前会签版本 v{{ version.version }}</strong>
                    }
                  </span>
                </div>
                @if (
                  item.status === 'draft' ||
                  item.status === 'rejected' ||
                  item.status === 'resubmit_required'
                ) {
                  <button
                    class="btn btn-primary"
                    type="button"
                    (click)="submitForReview()"
                    [disabled]="hasBlockers()"
                  >
                    {{ item.status === 'resubmit_required' ? '重新提交新版本' : '提交审批' }}
                  </button>
                }
              </div>
              @if (item.status === 'resubmit_required') {
                <div class="resubmit-card">
                  <strong>原签字已失效，需重新提交</strong>
                  <p>
                    已冻结方案的{{
                      latestInvalidatedAreas(item)
                    }}在会签后被修改，上一版本的四方意见全部作废。
                    重新提交将冻结为新版本，网络、系统、安全、业务意见按新版本重新会签。
                  </p>
                  <button type="button" class="link-btn" (click)="selectedTab.set('versions')">
                    查看历史版本与前后差异 →
                  </button>
                </div>
              }
              <ol class="approval-flow">
                @for (approval of item.approvals; track approval.stage) {
                  <li [ngClass]="approval.state">
                    <span class="flow-index">{{ $index + 1 }}</span>
                    <div>
                      <strong>{{ stageLabel(approval.stage) }}</strong>
                      <p>
                        {{ approval.comment || approvalStateText(approval.state) }}
                      </p>
                      @if (approval.approver) {
                        <small>
                          {{ approval.approver }} · {{ approval.decidedAt | date: 'MM-dd HH:mm' }}
                        </small>
                      }
                    </div>
                  </li>
                }
              </ol>
            </section>

            <section class="surface">
              <div class="surface-heading">
                <div>
                  <h2>会签操作</h2>
                  <span>只有当前顺位负责人可以签署</span>
                </div>
              </div>
              @if (pendingStage(); as stage) {
                @if (item.status === 'submitted' || item.status === 'rejected') {
                  <div class="approval-form">
                    <clr-input-container>
                      <label>审批人</label>
                      <input
                        clrInput
                        [ngModel]="approver()"
                        (ngModelChange)="approver.set($event)"
                      />
                    </clr-input-container>
                    <clr-textarea-container>
                      <label>意见</label>
                      <textarea
                        clrTextarea
                        rows="3"
                        [ngModel]="approvalComment()"
                        (ngModelChange)="approvalComment.set($event)"
                      ></textarea>
                    </clr-textarea-container>
                    <div class="approval-actions">
                      <button class="btn" type="button" (click)="reject(stage)">退回</button>
                      <button class="btn btn-primary" type="button" (click)="approve(stage)">
                        批准 {{ stageLabel(stage) }}
                      </button>
                    </div>
                  </div>
                } @else {
                  <p class="empty">当前状态不允许审批操作。</p>
                }
              } @else {
                <p class="approved-message">会签已完成。开始执行后审批记录自动冻结，不允许修改。</p>
              }
            </section>

            <section class="surface span-2">
              <div class="surface-heading">
                <div>
                  <h2>会签版本快照</h2>
                  <span>
                    执行与复盘以冻结版本为准
                    @if (activeVersion(); as version) {
                      <strong>· v{{ version.version }}</strong>
                    }
                  </span>
                </div>
                <button class="btn btn-sm" type="button" (click)="selectedTab.set('versions')">
                  历史版本与差异
                </button>
              </div>
              <div class="freeze-strip">
                @for (approval of item.approvals; track approval.stage) {
                  <div>
                    <span>{{ stageLabel(approval.stage) }}</span>
                    <strong>{{ approvalStateText(approval.state) }}</strong>
                    @if (approval.approver) {
                      <small>{{ approval.approver }}</small>
                    }
                  </div>
                }
              </div>
              @if (item.status === 'resubmit_required') {
                <p class="invalid-warning">
                  上一版本的原意见仍可在“版本与差异”中查阅，但已不再作为执行依据。
                </p>
              }
            </section>
          </div>
        }

        @case ('versions') {
          <section class="surface">
            <div class="surface-heading">
              <div>
                <h2>历史版本与前后差异</h2>
                <span>每次送审冻结一个版本；失效版本保留原意见，但不能勾选执行</span>
              </div>
            </div>
            <app-version-history [change]="item" />
          </section>
        }

        @case ('audit') {
          <div class="content-grid audit-grid">
            <section class="surface">
              <div class="surface-heading">
                <div>
                  <h2>审计轨迹</h2>
                  <span>创建、编辑、会签、执行和回滚均记录</span>
                </div>
                <button class="btn btn-sm" type="button" (click)="exportRetrospective()">
                  导出复盘记录
                </button>
              </div>
              <app-audit-trail [records]="item.audit" />
            </section>
            <section class="surface">
              <div class="surface-heading">
                <div>
                  <h2>复盘摘要</h2>
                  <span>进入正式变更档案的事实记录</span>
                </div>
              </div>
              <dl class="facts compact">
                <div>
                  <dt>最终状态</dt>
                  <dd>{{ statusLabel(item.status) }}</dd>
                </div>
                <div>
                  <dt>执行偏离</dt>
                  <dd>{{ item.deviations.length }} 条</dd>
                </div>
                <div>
                  <dt>审计事件</dt>
                  <dd>{{ item.audit.length }} 条</dd>
                </div>
                <div>
                  <dt>完成步骤</dt>
                  <dd>{{ completedSteps(item) }} / {{ item.steps.length }}</dd>
                </div>
              </dl>
              <div class="retrospective-note">
                <strong>导出内容</strong>
                <p>包含变更窗口、资源范围、执行偏离、最终状态和完整审计轨迹。</p>
              </div>
            </section>
          </div>
        }
      }
    } @else {
      <section class="not-found">
        <h1>变更不存在</h1>
        <p>该记录可能已被删除，或链接中的编号无效。</p>
        <a class="btn btn-primary" routerLink="/">返回变更队列</a>
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .detail-heading {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 24px;
        padding: 20px 0 24px;
        border-bottom: 1px solid #d7d7d7;
      }

      .back-link {
        display: inline-block;
        margin-bottom: 14px;
        font-size: 12px;
      }

      .title-row {
        display: flex;
        align-items: center;
        gap: 14px;
      }

      .change-id {
        color: #266c91;
        font-size: 12px;
        font-weight: 600;
      }

      h1 {
        margin: 2px 0 0;
        font-size: 28px;
      }

      .heading-main > p {
        max-width: 760px;
        margin: 12px 0 0;
        color: #5e5e5e;
      }

      .heading-meta {
        display: grid;
        grid-template-columns: repeat(3, minmax(90px, 1fr));
        align-self: end;
        border: 1px solid #d7d7d7;
        background: #fff;
      }

      .heading-meta div {
        padding: 12px 16px;
        border-left: 1px solid #e1e1e1;
      }

      .heading-meta div:first-child {
        border-left: 0;
      }

      .heading-meta span,
      .heading-meta strong {
        display: block;
      }

      .heading-meta span {
        color: #6d6d6d;
        font-size: 11px;
      }

      .heading-meta strong {
        margin-top: 4px;
        font-size: 13px;
      }

      .status {
        padding: 3px 9px;
        border: 1px solid #9a9a9a;
        background: #f3f3f3;
        color: #474747;
        font-size: 12px;
      }

      .status.submitted,
      .status.approved {
        border-color: #5688a5;
        background: #eaf4f9;
        color: #1d5877;
      }

      .status.resubmit_required {
        border-color: #d0a251;
        background: #fff7e6;
        color: #7c5000;
      }

      .version-chip {
        padding: 3px 9px;
        border: 1px solid #8fb99f;
        background: #edf7f0;
        color: #286140;
        font-size: 12px;
      }

      .version-chip.executing {
        border-color: #266c91;
        background: #eaf4f9;
        color: #1d5877;
      }

      .resubmit-banner {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 10px;
        margin-top: 12px;
        padding: 12px 14px;
        border-left: 3px solid #d0a251;
        background: #fff7e6;
        color: #5f4400;
        font-size: 13px;
      }

      .resubmit-banner strong {
        color: #7c5000;
      }

      .link-btn {
        padding: 0;
        border: 0;
        background: none;
        color: #1d5877;
        text-decoration: underline;
        cursor: pointer;
        font: inherit;
      }

      .status.executing,
      .status.completed {
        border-color: #75a489;
        background: #edf7f0;
        color: #245f3d;
      }

      .status.rejected,
      .status.rolled_back {
        border-color: #d58d7e;
        background: #fbece8;
        color: #8e260f;
      }

      .tab-nav {
        display: flex;
        gap: 0;
        margin-bottom: 20px;
        border-bottom: 1px solid #d7d7d7;
        overflow-x: auto;
      }

      .tab-nav button {
        position: relative;
        padding: 13px 18px;
        border: 0;
        border-bottom: 3px solid transparent;
        background: transparent;
        color: #575757;
        cursor: pointer;
        white-space: nowrap;
      }

      .tab-nav button.active {
        border-bottom-color: #266c91;
        color: #174d6a;
        font-weight: 600;
      }

      .nav-badge {
        margin-left: 6px;
        padding: 1px 5px;
        background: #eaf4f9;
        color: #215a78;
        font-size: 10px;
      }

      .content-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
      }

      .surface {
        padding: 18px;
        border: 1px solid #d7d7d7;
        background: #fff;
      }

      .span-2 {
        grid-column: 1 / -1;
      }

      .surface-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding-bottom: 14px;
        border-bottom: 1px solid #e3e3e3;
      }

      .surface-heading h2 {
        margin: 0;
        font-size: 17px;
      }

      .surface-heading span {
        color: #666;
        font-size: 12px;
      }

      .facts {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1px;
        margin: 18px 0 0;
        background: #e1e1e1;
      }

      .facts div {
        padding: 14px;
        background: #fafafa;
      }

      .facts dt {
        color: #666;
        font-size: 12px;
      }

      .facts dd {
        margin: 5px 0 0;
        font-weight: 600;
      }

      .facts.compact {
        margin-top: 16px;
      }

      .edit-form {
        padding-top: 18px;
      }

      .edit-block {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px dashed #d0d0d0;
      }

      .edit-block h3 {
        margin: 0;
        font-size: 14px;
      }

      .block-hint {
        margin: 4px 0 10px;
        color: #8a6d2f;
        font-size: 11px;
      }

      .mini-form,
      .step-mini {
        display: grid;
        grid-template-columns: repeat(4, minmax(110px, 1fr)) auto;
        gap: 10px;
        align-items: end;
        margin-bottom: 10px;
      }

      .edit-list {
        margin: 8px 0 0;
        padding: 0;
        list-style: none;
      }

      .edit-list li {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 2px;
        border-bottom: 1px solid #ececec;
      }

      .edit-item-main {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 2px;
      }

      .edit-item-main span {
        color: #777;
        font-size: 11px;
      }

      .inline-check {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: #555;
      }

      .invalid-warning {
        margin: 14px 0 0;
        padding: 12px 14px;
        border-left: 3px solid #c21d00;
        background: #fbece8;
        color: #8e260f;
        font-size: 12px;
      }

      .invalid-warning p {
        margin: 6px 0 0;
        line-height: 1.6;
      }

      .resubmit-card {
        margin-top: 14px;
        padding: 14px;
        border-left: 3px solid #d0a251;
        background: #fff7e6;
      }

      .resubmit-card p {
        margin: 6px 0 8px;
        color: #5f4400;
        font-size: 12px;
        line-height: 1.6;
      }

      .freeze-strip small {
        display: block;
        margin-top: 3px;
        color: #888;
        font-size: 10px;
      }

      .edit-grid,
      .deviation-actions {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
      }

      .edit-actions,
      .completion-actions,
      .approval-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 16px;
      }

      .resource-table article {
        display: grid;
        grid-template-columns: 80px minmax(180px, 1fr) 100px 120px;
        align-items: center;
        gap: 14px;
        padding: 12px 4px;
        border-bottom: 1px solid #e6e6e6;
      }

      .resource-table article:last-child {
        border-bottom: 0;
      }

      .resource-table article div {
        display: flex;
        flex-direction: column;
      }

      .resource-table small,
      .resource-table article > span:last-child {
        color: #6b6b6b;
        font-size: 11px;
      }

      .type,
      .phase {
        display: inline-block;
        width: fit-content;
        padding: 2px 7px;
        background: #edf3f6;
        color: #205d7e;
        font-size: 11px;
      }

      .conflict-notes {
        margin-top: 16px;
      }

      .conflict-notes article {
        padding: 14px;
        border-left: 3px solid #c21d00;
        background: #fbece8;
      }

      .conflict-notes p {
        margin: 6px 0;
      }

      .conflict-notes span {
        color: #8e260f;
        font-size: 12px;
      }

      .step-row {
        display: grid;
        grid-template-columns: 20px 50px 1fr 90px;
        align-items: center;
        gap: 12px;
        padding: 14px 2px;
        border-bottom: 1px solid #e6e6e6;
      }

      .step-row.completed {
        background: #f5faf6;
      }

      .step-row div {
        display: flex;
        flex-direction: column;
      }

      .step-row code {
        margin-top: 4px;
        color: #666;
        font-size: 11px;
      }

      .deviation-form {
        padding: 16px 0;
        border-bottom: 1px solid #e3e3e3;
      }

      .deviation-actions {
        grid-template-columns: 1fr auto;
        align-items: end;
      }

      .deviation-list article {
        padding: 12px 0;
        border-bottom: 1px solid #e6e6e6;
      }

      .deviation-list article > div {
        display: flex;
        justify-content: space-between;
      }

      .deviation-list p {
        margin: 7px 0;
      }

      .deviation-list span {
        color: #8e260f;
        font-size: 11px;
      }

      .approval-flow {
        margin: 18px 0 0;
        padding: 0;
        list-style: none;
      }

      .approval-flow li {
        display: grid;
        grid-template-columns: 32px 1fr;
        gap: 12px;
        padding: 12px 0;
        border-bottom: 1px solid #e6e6e6;
      }

      .flow-index {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: 1px solid #9d9d9d;
        color: #555;
      }

      .approval-flow li.approved .flow-index {
        border-color: #4b8d65;
        background: #e8f5ed;
        color: #245f3d;
      }

      .approval-flow li.rejected .flow-index {
        border-color: #c21d00;
        background: #fbece8;
        color: #8e260f;
      }

      .approval-flow p {
        margin: 5px 0;
        color: #5f5f5f;
      }

      .approval-flow small {
        color: #737373;
      }

      .approval-form {
        padding-top: 16px;
      }

      .approved-message {
        margin: 18px 0 0;
        padding: 16px;
        border-left: 3px solid #4b8d65;
        background: #edf7f0;
        color: #245f3d;
      }

      .freeze-strip {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 1px;
        margin-top: 18px;
        background: #d7d7d7;
      }

      .freeze-strip div {
        display: flex;
        flex-direction: column;
        padding: 14px;
        background: #fafafa;
      }

      .freeze-strip span {
        color: #666;
        font-size: 11px;
      }

      .freeze-strip strong {
        margin-top: 4px;
      }

      .retrospective-note {
        margin-top: 18px;
        padding: 16px;
        background: #f4f6f7;
      }

      .retrospective-note p {
        margin: 6px 0 0;
        color: #5f5f5f;
      }

      .empty {
        color: #737373;
      }

      .not-found {
        margin-top: 50px;
        padding: 48px;
        text-align: center;
        border: 1px solid #d7d7d7;
        background: #fff;
      }

      @media (max-width: 1100px) {
        .detail-heading,
        .content-grid {
          grid-template-columns: 1fr;
        }

        .span-2 {
          grid-column: auto;
        }
      }

      @media (max-width: 700px) {
        .heading-meta,
        .facts,
        .edit-grid,
        .freeze-strip,
        .mini-form,
        .step-mini {
          grid-template-columns: 1fr;
        }

        .heading-meta div {
          border-left: 0;
          border-top: 1px solid #e1e1e1;
        }

        .resource-table article,
        .step-row {
          grid-template-columns: 1fr;
        }

        .tab-nav {
          padding-bottom: 4px;
        }
      }
    `,
  ],
})
export class ChangeDetailComponent {
  private readonly store = inject(Store);
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(ChangeRequestService);
  private readonly changeId = this.route.snapshot.paramMap.get('id') ?? '';

  readonly changes = this.store.selectSignal(selectAllChanges);
  readonly change = computed(() => this.changes().find((item) => item.id === this.changeId));
  readonly selectedTab = signal<DetailTab>('overview');
  readonly editing = signal(false);
  readonly draft = signal<ChangeRequest | null>(null);
  readonly approver = signal('');
  readonly approvalComment = signal('');
  readonly deviationText = signal('');
  readonly deviationDecision = signal<DeviationRecord['decision']>('continue');

  readonly newResourceId = signal('');
  readonly newResourceName = signal('');
  readonly newResourceType = signal<ChangeResource['type']>('rack');
  readonly newDependencyText = signal('');
  readonly newStepTitle = signal('');
  readonly newStepPhase = signal<StepPhase>('execute');
  readonly newStepOwner = signal('');
  readonly newStepCommand = signal('');
  readonly resourceTypes: ChangeResource['type'][] = [
    'datacenter',
    'rack',
    'network',
    'storage',
    'service',
  ];

  readonly activeVersion = computed(() => {
    const item = this.change();
    if (!item || !['submitted', 'approved'].includes(item.status)) {
      return undefined;
    }
    return getActiveVersion(item);
  });

  /** 执行页只读的版本：执行锁定版本优先，其次当前有效版本 */
  readonly effectivePlanVersion = computed(() => {
    const item = this.change();
    return item ? getEffectivePlan(item) : undefined;
  });

  /** 编辑中的工作副本相对当前有效版本的实质性差异 */
  readonly pendingMaterialDiff = computed(() => {
    const item = this.change();
    const draft = this.draft();
    const active = item ? getActiveVersion(item) : undefined;
    if (!item || !draft || !active || !['submitted', 'approved'].includes(item.status)) {
      return null;
    }
    const diff = diffPlanVersions(active, draft);
    return diff.areas.length ? diff : null;
  });

  readonly tabs: Array<{ id: DetailTab; label: string }> = [
    { id: 'overview', label: '方案概览' },
    { id: 'dependency', label: '依赖关系' },
    { id: 'window', label: '窗口甘特' },
    { id: 'execution', label: '执行记录' },
    { id: 'approval', label: '审批会签' },
    { id: 'versions', label: '版本与差异' },
    { id: 'audit', label: '审计复盘' },
  ];

  readonly issues = computed(() => {
    const item = this.change();
    return item ? validateChange(item, this.changes()) : [];
  });

  readonly hasBlockers = computed(() =>
    this.issues().some((issue) => issue.severity === 'blocker'),
  );

  readonly pendingStage = computed<ApprovalStage | null>(() => {
    const item = this.change();
    if (!item || !['submitted', 'rejected'].includes(item.status)) {
      return null;
    }
    const rejected = item.approvals.find((approval) => approval.state === 'rejected');
    if (rejected) {
      return rejected.stage;
    }
    return item.approvals.find((approval) => approval.state === 'pending')?.stage ?? null;
  });
  beginEdit(): void {
    const item = this.change();
    if (!item) {
      return;
    }
    this.draft.set(structuredClone(item));
    this.newResourceId.set('');
    this.newResourceName.set('');
    this.newDependencyText.set('');
    this.newStepTitle.set('');
    this.newStepOwner.set('');
    this.newStepCommand.set('');
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.draft.set(null);
  }

  addDraftResource(): void {
    const name = this.newResourceName().trim();
    if (!name) {
      return;
    }
    const id = this.newResourceId().trim() || name.toLowerCase().replace(/\s+/g, '-');
    this.draft.update((draft) =>
      draft
        ? {
            ...draft,
            resources: [
              ...draft.resources,
              {
                id,
                name,
                type: this.newResourceType(),
                critical: false,
                dependencies: this.newDependencyText()
                  .split(/[、,，]/)
                  .map((item) => item.trim())
                  .filter(Boolean),
              },
            ],
          }
        : draft,
    );
    this.newResourceId.set('');
    this.newResourceName.set('');
    this.newDependencyText.set('');
  }

  removeDraftResource(resourceId: string): void {
    this.draft.update((draft) =>
      draft
        ? {
            ...draft,
            resources: draft.resources.filter((resource) => resource.id !== resourceId),
          }
        : draft,
    );
  }

  toggleDraftResourceCritical(resourceId: string): void {
    this.draft.update((draft) =>
      draft
        ? {
            ...draft,
            resources: draft.resources.map((resource) =>
              resource.id === resourceId ? { ...resource, critical: !resource.critical } : resource,
            ),
          }
        : draft,
    );
  }

  addDraftStep(): void {
    const title = this.newStepTitle().trim();
    if (!title) {
      return;
    }
    this.draft.update((draft) =>
      draft
        ? {
            ...draft,
            steps: [
              ...draft.steps,
              {
                id: `step-${Date.now()}`,
                phase: this.newStepPhase(),
                title,
                owner: this.newStepOwner().trim(),
                durationMinutes: 15,
                command: this.newStepCommand().trim(),
                completed: false,
              },
            ],
          }
        : draft,
    );
    this.newStepTitle.set('');
    this.newStepOwner.set('');
    this.newStepCommand.set('');
  }

  removeDraftStep(stepId: string): void {
    this.draft.update((draft) =>
      draft ? { ...draft, steps: draft.steps.filter((step) => step.id !== stepId) } : draft,
    );
  }

  updateDraft<K extends keyof ChangeRequest>(key: K, value: ChangeRequest[K]): void {
    this.draft.update((draft) => (draft ? { ...draft, [key]: value } : draft));
  }

  updateDraftWindow(key: 'start' | 'end', value: string): void {
    this.draft.update((draft) =>
      draft ? { ...draft, window: { ...draft.window, [key]: value } } : draft,
    );
  }

  updateObservation(value: string | number): void {
    this.draft.update((draft) =>
      draft
        ? {
            ...draft,
            window: { ...draft.window, observationWindowMinutes: Number(value) || 0 },
          }
        : draft,
    );
  }

  saveEdit(): void {
    const draft = this.draft();
    if (!draft) {
      return;
    }
    const willInvalidate = !!this.pendingMaterialDiff();
    this.store.dispatch(ChangeRequestActions.updateChange({ change: draft }));
    this.editing.set(false);
    this.draft.set(null);
    if (willInvalidate) {
      this.selectedTab.set('approval');
    }
  }

  submitForReview(): void {
    if (!this.hasBlockers()) {
      this.store.dispatch(ChangeRequestActions.submitForReview({ id: this.changeId }));
    }
  }

  approve(stage: ApprovalStage): void {
    const approver = this.approver().trim() || '当前用户';
    const comment = this.approvalComment().trim() || '同意按方案执行。';
    this.store.dispatch(
      ChangeRequestActions.approveStage({
        id: this.changeId,
        stage,
        approver,
        comment,
      }),
    );
    this.clearApprovalForm();
  }

  reject(stage: ApprovalStage): void {
    const approver = this.approver().trim() || '当前用户';
    const comment = this.approvalComment().trim();
    if (!comment) {
      return;
    }
    this.store.dispatch(
      ChangeRequestActions.rejectStage({
        id: this.changeId,
        stage,
        approver,
        comment,
      }),
    );
    this.clearApprovalForm();
  }

  startExecution(): void {
    this.store.dispatch(ChangeRequestActions.startExecution({ id: this.changeId }));
  }

  toggleStep(stepId: string): void {
    this.store.dispatch(ChangeRequestActions.toggleStep({ id: this.changeId, stepId }));
  }

  recordDeviation(): void {
    const description = this.deviationText().trim();
    if (!description) {
      return;
    }
    const deviation: DeviationRecord = {
      id: `dev-${Date.now()}`,
      recordedAt: new Date().toISOString(),
      owner: this.change()?.onCall[0] ?? '当前用户',
      description,
      decision: this.deviationDecision(),
    };
    this.store.dispatch(ChangeRequestActions.recordDeviation({ id: this.changeId, deviation }));
    this.deviationText.set('');
  }

  complete(result: 'completed' | 'rolled_back'): void {
    const note =
      result === 'completed'
        ? '观察窗口内指标稳定，变更完成。'
        : '发现不可接受影响，按方案完成回滚。';
    this.store.dispatch(
      ChangeRequestActions.completeExecution({ id: this.changeId, result, note }),
    );
  }

  exportRetrospective(): void {
    const item = this.change();
    if (!item) {
      return;
    }
    const blob = new Blob([this.service.exportRetrospective(item)], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${item.id}-retrospective.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  stepsBy(plan: { steps: ChangeStep[] }): ChangeStep[] {
    const order: ChangeStep['phase'][] = ['prepare', 'execute', 'verify', 'rollback'];
    return [...plan.steps].sort((left, right) => {
      const phase = order.indexOf(left.phase) - order.indexOf(right.phase);
      return phase || left.id.localeCompare(right.id);
    });
  }

  completedSteps(change: ChangeRequest): number {
    return change.steps.filter((step) => step.completed).length;
  }

  statusLabel(status: ChangeRequest['status']): string {
    return STATUS_LABELS[status];
  }

  riskLabel(risk: ChangeRequest['risk']): string {
    return RISK_LABELS[risk];
  }

  resourceLabel(type: ChangeRequest['resources'][number]['type']): string {
    return RESOURCE_LABELS[type];
  }

  stageLabel(stage: ApprovalStage): string {
    return STAGE_LABELS[stage];
  }

  phaseLabel(phase: ChangeStep['phase']): string {
    return PHASE_LABELS[phase];
  }

  approvalStateText(state: ChangeRequest['approvals'][number]['state']): string {
    return {
      pending: '等待签署',
      approved: '已批准',
      rejected: '已退回',
      frozen: '已冻结',
    }[state];
  }

  approvalGate(): string {
    const item = this.change();
    if (!item) {
      return '-';
    }
    if (item.status === 'resubmit_required') {
      return '旧签字已失效，待重新提交';
    }
    if (item.status === 'approved') {
      return '已批准，等待执行';
    }
    if (['executing', 'completed', 'rolled_back'].includes(item.status)) {
      return `执行锁定 v${item.executingVersion ?? 1}`;
    }
    return '方案草稿';
  }

  effectivePlan(item: ChangeRequest) {
    return getEffectivePlan(item);
  }

  effectiveVersionLabel(item: ChangeRequest): string {
    const plan = getEffectivePlan(item);
    if (!plan) {
      return item.status === 'resubmit_required' ? '无（待重新提交新版本）' : '尚未送审';
    }
    const suffix = item.executingVersion === plan.version ? '（执行锁定）' : '';
    return `v${plan.version}${suffix}`;
  }

  latestInvalidatedAreas(item: ChangeRequest): string {
    const version = item.versions.find((candidate) => candidate.state === 'invalidated');
    if (!version || version.invalidatedAreas.length === 0) {
      return '内容';
    }
    return version.invalidatedAreas.map((area) => DIFF_AREA_LABELS[area]).join('、');
  }

  areaLabel(area: keyof typeof DIFF_AREA_LABELS): string {
    return DIFF_AREA_LABELS[area];
  }

  decisionLabel(decision: DeviationRecord['decision']): string {
    return {
      continue: '继续观察',
      pause: '暂停执行',
      rollback: '立即回滚',
    }[decision];
  }

  private clearApprovalForm(): void {
    this.approver.set('');
    this.approvalComment.set('');
  }
}
