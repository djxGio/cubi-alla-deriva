import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  public state: State = { hasError: false, message: '' };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Errore imprevisto nel gioco.' };
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950 p-6 text-slate-100">
          <div className="max-w-md rounded-2xl border border-rose-500/40 bg-slate-900 p-6 shadow-2xl">
            <h2 className="font-display text-xl font-bold text-rose-400">
              Si è verificato un problema
            </h2>
            <p className="mt-2 text-sm text-slate-300 break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
            >
              Ricarica l’Isola
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
