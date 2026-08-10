import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './ui';

export class RouteErrorBoundary extends Component<
  { children: ReactNode; message?: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('Route rendering failed', { error, componentStack: info.componentStack });
    } else {
      console.error('Route rendering failed');
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <ErrorState
          message={this.props.message ?? 'This page could not be displayed.'}
          retry={() => this.setState({ failed: false })}
        />
      );
    }
    return this.props.children;
  }
}

/** Application-level boundary so auth/bootstrap failures never produce a blank root. */
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('Application rendering failed', { error, componentStack: info.componentStack });
    } else {
      console.error('Application rendering failed');
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="grid min-h-screen place-items-center bg-slate-950 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-100">
            <h1 className="text-lg font-bold">Unable to load Cloudflare DDNS Manager</h1>
            <p className="mt-3 text-sm text-slate-400">
              An unexpected error occurred while starting the application.
            </p>
            <button
              type="button"
              className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700"
              onClick={() => {
                this.setState({ failed: false });
                window.location.reload();
              }}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
