import { Component, type ReactNode } from 'react';

interface Props {
  pagePath: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** Isolates a runtime crash to one kept-alive page so it can't blank the page the user is looking at. */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[KeepAlive] Page crashed: ${this.props.pagePath}`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center h-full text-muted text-sm">
          This page hit an error. Switch away and back to reload it.
        </div>
      );
    }
    return this.props.children;
  }
}
