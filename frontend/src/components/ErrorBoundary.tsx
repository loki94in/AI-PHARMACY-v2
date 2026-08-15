import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught UI error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-bg text-text">
          <div className="max-w-md w-full p-8 rounded-2xl bg-bg2 border border-border text-center shadow-2xl">
            <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-bg3 border border-border flex items-center justify-center text-red-500 font-bold text-2xl">
              !
            </div>
            <h2 className="text-xl font-bold text-text mb-2">Something went wrong</h2>
            <p className="text-sm text-muted mb-6 leading-relaxed">
              The application encountered an unexpected visual error. You can reload the page to safely resume work without losing data.
            </p>
            {this.state.error?.message && (
              <div className="mb-6 p-3 rounded-lg bg-bg3 border border-border text-xs text-muted font-mono text-left overflow-auto max-h-24">
                {this.state.error.message}
              </div>
            )}
            <button
              onClick={this.handleReset}
              className="px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium text-sm transition-all shadow-lg shadow-sky-600/20 active:scale-95"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
