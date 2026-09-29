import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of, tap } from 'rxjs';
import {
  ChangeRequest,
  STAGE_LABELS,
  VERSION_STATE_LABELS,
  normalizeChange,
} from '../models/change-request.model';

const STORAGE_KEY = 'pair-wise-gsb-69-changes';

@Injectable({ providedIn: 'root' })
export class ChangeRequestService {
  private readonly http = inject(HttpClient);

  load(): Observable<ChangeRequest[]> {
    const localValue = localStorage.getItem(STORAGE_KEY);
    if (localValue) {
      try {
        return of((JSON.parse(localValue) as ChangeRequest[]).map(normalizeChange));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    return this.http.get<ChangeRequest[]>('/mock/change-requests.json').pipe(
      map((changes) => changes.map(normalizeChange)),
      tap((changes) => this.save(changes)),
      catchError((error: unknown) => {
        console.error('Failed to load change requests', error);
        return of([]);
      }),
    );
  }

  save(changes: ChangeRequest[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changes));
  }

  exportRetrospective(change: ChangeRequest): string {
    const lines = [
      `# ${change.id} ${change.title} 复盘记录`,
      '',
      `状态：${change.status}`,
      `执行版本：第 ${change.currentVersion ?? '-'} 版`,
      `负责人：${change.owner}`,
      `窗口：${change.window.start} - ${change.window.end}`,
      `风险等级：${change.risk}`,
      '',
      '## 送审版本与原始会签意见',
      ...(change.versions.length
        ? change.versions.flatMap((version) => [
            `### 第 ${version.version} 版（${VERSION_STATE_LABELS[version.state]}）`,
            `- 送审时间：${version.createdAt}`,
            `- 参与对象：${version.resources.map((resource) => resource.name).join('、') || '无'}`,
            `- 窗口：${version.window.start} - ${version.window.end}（观察 ${version.window.observationWindowMinutes} 分钟）`,
            `- 步骤摘要：${version.steps.map((step) => step.title).join('、') || '无'}`,
            ...(version.invalidatedReason ? [`- 失效原因：${version.invalidatedReason}`] : []),
            ...version.approvals.map(
              (approval) =>
                `- ${STAGE_LABELS[approval.stage]}：${approval.state}${
                  approval.approver ? `（${approval.approver}）` : ''
                }${approval.comment ? ` ${approval.comment}` : ''}`,
            ),
            '',
          ])
        : ['- 无送审版本', '']),
      '## 执行偏离',
      ...(change.deviations.length
        ? change.deviations.map(
            (item) =>
              `- ${item.recordedAt} ${item.owner} [${item.decision}] ${item.description}`,
          )
        : ['- 无']),
      '',
      '## 审计轨迹',
      ...change.audit.map(
        (item) => `- ${item.timestamp} ${item.actor} ${item.action}：${item.detail}`,
      ),
    ];
    return lines.join('\n');
  }
}
