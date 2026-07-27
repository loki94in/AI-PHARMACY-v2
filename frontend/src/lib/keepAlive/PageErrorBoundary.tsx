import React, { Component, type ReactNode } from 'react';
import { RotateCcw, AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  pagePath: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** Isolates a runtime crash to one kept-alive page so it can't blank the page the user is looking at. */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown) {
    console.error(`[KeepAlive] Page crashed: ${this.props.pagePath}`, error);
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.pagePath !== this.props.pagePath && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleResetStorage = () => {
    try {
      if (this.props.pagePath.includes('purchases')) {
        localStorage.removeItem('purchase_tabs');
        localStorage.removeItem('purchase_active_tab_id');
      }
      localStorage.clear();
    } catch { }
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center h-full p-6 text-center bg-bg/50 backdrop-blur-md">
          <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-2xl max-w-md w-full space-y-4 shadow-xl">
            <div className="inline-flex p-3 rounded-full bg-red-500/15 text-red-400">
              <AlertTriangle size={28} />
            </div>
            <div>
              <h3 className="text-base font-bold text-text mb-1">Page Error Recovered</h3>
              <p className="text-xs text-muted leading-relaxed">
                {this.state.error?.message || 'A temporary state error occurred while rendering the page.'}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                onClick={this.handleRetry}
                className="flex-1 py-2 px-4 rounded-xl text-xs font-bold bg-primary hover:bg-primary/90 text-white transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
              >
                <RefreshCw size={14} />
                Reload Page
              </button>

              <button
                onClick={this.handleResetStorage}
                className="flex-1 py-2 px-4 rounded-xl text-xs font-bold bg-white/5 border border-glass-border hover:bg-white/10 text-muted hover:text-text transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RotateCcw size={14} />
                Reset Saved State
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
