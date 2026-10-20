import { Component } from 'react';
import type { PropsWithChildren } from 'react';

export class ErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="error-recovery" role="alert">
          <section className="panel">
            <h1>This page could not load.</h1>
            <p>
              Reload to try again. If you were submitting a change, check whether it was saved
              before repeating it.
            </p>
            <button className="primary" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
