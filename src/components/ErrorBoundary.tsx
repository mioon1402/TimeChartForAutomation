/**
 * 화면을 그리다 오류가 나도 흰 화면이 되지 않게: 작업은 자동 백업되어 있다고 알리고,
 * 지금 작업을 파일로 받거나 다시 시도할 수 있게 한다.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useStore } from '../store/store';
import { documentTitle, serializeDocument } from '../model/book';
import { downloadText, safeFileName } from '../io/files';
import { tr } from '../i18n';
import { ISSUES_URL } from '../env';

interface Props {
  children: ReactNode;
  /** 어느 화면인지 (알림 문구용) */
  area?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('TimeChart Studio 화면 오류', error, info.componentStack);
  }

  private save = () => {
    try {
      const doc = useStore.getState().getDocument();
      downloadText(`${safeFileName(documentTitle(doc))}_복구.tchart`, serializeDocument(doc), 'application/json');
    } catch (e) {
      alert(tr('파일로 받지 못했습니다: ', 'Could not save: ') + (e as Error).message);
    }
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-card">
          <h2>{tr('화면을 그리다 문제가 생겼습니다', 'Something went wrong drawing this screen')}</h2>
          <p>
            {tr(
              `작업 내용은 이 브라우저에 자동 백업되어 있어 사라지지 않았습니다. 먼저 "지금 작업 파일로 받기"로 보관한 뒤 다시 시도해 보세요.${this.props.area ? ` 위쪽 탭으로 다른 화면(${this.props.area} 말고)으로 옮겨 계속 작업할 수도 있습니다.` : ''}`,
              'Your work is auto-saved in this browser. Save a copy first, then try again, or switch to another tab to keep working.',
            )}
          </p>
          <div className="crash-btns">
            <button type="button" className="btn primary" onClick={this.save}>
              {tr('지금 작업 파일로 받기', 'Save my work to a file')}
            </button>
            <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
              {tr('다시 시도', 'Try again')}
            </button>
            <button type="button" className="btn" onClick={() => location.reload()}>
              {tr('새로고침', 'Reload')}
            </button>
          </div>
          <details className="crash-detail">
            <summary>{tr('문제 신고용 정보', 'Details for a bug report')}</summary>
            <pre>{`${error.name}: ${error.message}\n${(error.stack ?? '').split('\n').slice(1, 6).join('\n')}`}</pre>
            <a href={ISSUES_URL} target="_blank" rel="noreferrer">
              {tr('문제 신고하기 (회사 파일은 올리지 마세요)', 'Report the problem (do not attach company files)')}
            </a>
          </details>
        </div>
      </div>
    );
  }
}
