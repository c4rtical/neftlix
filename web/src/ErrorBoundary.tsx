import { Component, type ReactNode } from 'react';

type State = { error: Error | null };

/** Shows the error instead of a blank page when rendering throws. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <h2>Qualcosa è andato storto</h2>
        <pre className="error" style={{ whiteSpace: 'pre-wrap' }}>
          {this.state.error.message}
          {'\n'}
          {this.state.error.stack}
        </pre>
        <button className="btn btn-primary" onClick={() => window.location.assign('/')}>
          Ricarica
        </button>
      </div>
    );
  }
}
