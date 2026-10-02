import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logError } from '@/helpers/reportError';

type EditorErrorBoundaryProps = {
  editorId: string;
  /** Rendered instead of the editor once it has thrown. */
  fallback: ReactNode;
  children: ReactNode;
};

type EditorErrorBoundaryState = { failed: boolean };

/**
 * Keeps a crashing custom editor from taking the whole form down: the field falls back to its built-in
 * editor. React only offers error boundaries as class components, so this is the one class in the admin.
 */
export class EditorErrorBoundary extends Component<EditorErrorBoundaryProps, EditorErrorBoundaryState> {
  override state: EditorErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): EditorErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    logError(error, `custom editor ${this.props.editorId} crashed${info.componentStack ?? ''}`);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
