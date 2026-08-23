import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : '未知错误' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('花众打印插件加载失败', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="startup-error"><strong>插件加载失败</strong><p>{this.state.error}</p><button type="button" onClick={() => window.location.reload()}>重新加载</button></main>;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>,
);
