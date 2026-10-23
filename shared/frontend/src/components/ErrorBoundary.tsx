import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a crash while drawing a page, so the user sees what happened and a way out instead of a blank screen.
 * `resetKey` (e.g. the address) clears the error when the user goes to another page.
 */
export class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null; key: string }> {
  override state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AutoSense page crashed', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="as-boot">
        <div className="as-state-card" role="alert" style={{ maxWidth: 420 }}>
          <div className="as-state-icon as-tone-danger"><i className="bi bi-exclamation-triangle" aria-hidden="true" /></div>
          <h1 className="h6 fw-semibold">This page couldn't be shown</h1>
          <p className="text-body-secondary small mb-3">Something went wrong while drawing it. Reloading usually fixes it.</p>
          <div className="d-flex gap-2 justify-content-center">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>Reload</button>
            <a className="btn btn-light btn-sm" href="/">Go to the home page</a>
          </div>
        </div>
      </div>
    );
  }
}
