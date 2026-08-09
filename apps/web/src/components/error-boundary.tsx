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
    console.error('Route rendering failed', { error, componentStack: info.componentStack });
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
