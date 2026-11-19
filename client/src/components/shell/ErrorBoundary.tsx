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
      <div className="m-4 max-w-xl border border-red-300 bg-red-50 p-4 text-[12px] text-red-800">
        <div className="mb-1 flex items-center gap-2 font-semibold">
          <AlertOctagon size={16} /> This screen crashed
        </div>
        <div className="mb-3 break-words font-mono text-[11px]">{this.state.error.message}</div>
        <button
          className="rounded border border-red-400 bg-white px-3 py-1 hover:bg-red-100"
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
