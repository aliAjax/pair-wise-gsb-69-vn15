import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, of, tap } from 'rxjs';
import { ChangeRequest } from '../models/change-request.model';

const STORAGE_KEY = 'pair-wise-gsb-69-changes';

@Injectable({ providedIn: 'root' })
export class ChangeRequestService {
  private readonly http = inject(HttpClient);

  load(): Observable<ChangeRequest[]> {
    const localValue = localStorage.getItem(STORAGE_KEY);
    if (localValue) {
      try {
        return of(JSON.parse(localValue) as ChangeRequest[]);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    return this.http.get<ChangeRequest[]>('/mock/change-requests.json').pipe(
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
      `负责人：${change.owner}`,
      `窗口：${change.window.start} - ${change.window.end}`,
      `风险等级：${change.risk}`,
      `执行版本：v${change.executingVersion ?? change.versions[0]?.version ?? '未冻结'}`,
      '',
      '## 送审版本',
      ...(change.versions.length
        ? change.versions.map((version) => {
            const stateText = {
              active: '有效',
              invalidated: '已失效（旧签字作废）',
              superseded: '已冻结/归档',
            }[version.state];
            const approvals = version.approvals
              .map((approval) => {
                const result = {
                  pending: '待签',
                  approved: '批准',
                  rejected: '退回',
                  frozen: '冻结',
                }[approval.state];
                const who = approval.approver ? `${approval.approver}` : '—';
                const opinion = approval.comment ? `：${approval.comment}` : '';
                return `  - ${approval.stage} ${result} ${who}${opinion}`;
              })
              .join('\n');
            return `- v${version.version}（${stateText}，送审 ${version.submittedAt}）\n${approvals}`;
          })
        : ['- 无送审版本']),
      '',
      '## 执行偏离',
      ...(change.deviations.length
        ? change.deviations.map(
            (item) => `- ${item.recordedAt} ${item.owner} [${item.decision}] ${item.description}`,
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
