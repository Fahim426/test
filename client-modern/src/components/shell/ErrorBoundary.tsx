import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon } from 'lucide-react';

interface Props {
  children: ReactNode;
  onReset?: () => void;
  label?: string;
}
interface State {
  error: Error | null;
}

/** One per workspace tab so a crashing screen never takes the shell down. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[screen:${this.props.label ?? '?'}]`, error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-6 max-w-xl rounded-card border border-danger/30 bg-danger-soft p-5 text-[13px] text-danger">
        <div className="mb-1 flex items-center gap-2 font-semibold">
          <AlertOctagon size={16} /> This screen crashed
        </div>
        <div className="mb-3 break-words font-mono text-[11px]">{this.state.error.message}</div>
        <button
          className="h-8 rounded-lg border border-danger/30 bg-surface px-3 font-medium transition hover:bg-surface-2"
          onClick={() => {
            this.setState({ error: null });
            this.props.onReset?.();
          }}
        >
          Reload screen
        </button>
      </div>
    );
  }
}
