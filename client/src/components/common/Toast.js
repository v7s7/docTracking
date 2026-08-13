import React, { createContext, useContext, useCallback, useState, useRef } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

// App-wide transient feedback. Replaces the inline `alert` divs that stayed on
// screen until the user navigated away — a success message for an action that
// finished three screens ago is noise, not feedback.
//
// Usage:  const toast = useToast();  toast.success('تم الإرسال');
const ToastContext = createContext(null);

const ICONS = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };
const LIFETIME = { success: 3500, info: 3500, warning: 5000, error: 6000 };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback(id => {
    setToasts(list => list.filter(x => x.id !== id));
  }, []);

  const push = useCallback((message, kind = 'info') => {
    if (!message) return;
    const id = ++seq.current;
    setToasts(list => [...list, { id, message: String(message), kind }]);
    // Errors linger longest; nothing stays forever.
    setTimeout(() => dismiss(id), LIFETIME[kind] || 4000);
    return id;
  }, [dismiss]);

  const api = React.useMemo(() => ({
    push,
    dismiss,
    success: m => push(m, 'success'),
    error:   m => push(m, 'error'),
    warning: m => push(m, 'warning'),
    info:    m => push(m, 'info'),
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map(item => {
          const Icon = ICONS[item.kind] || Info;
          return (
            <div className={`toast toast-${item.kind}`} key={item.id}>
              <Icon size={17} strokeWidth={2} className="toast-icon" />
              <span className="toast-msg">{item.message}</span>
              <button
                type="button"
                className="toast-x"
                onClick={() => dismiss(item.id)}
                aria-label="إغلاق">
                <X size={13} strokeWidth={2.5} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  // Never crash a screen because it was rendered outside the provider —
  // fall back to a no-op so the underlying action still completes.
  return ctx || { push() {}, dismiss() {}, success() {}, error() {}, warning() {}, info() {} };
}
