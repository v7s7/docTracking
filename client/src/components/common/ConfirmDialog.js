import { useState, useRef, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useLang } from '../../context/LangContext';

// Drop-in replacement for window.confirm() that matches the app's modal styling.
// Usage: const [confirm, confirmDialog] = useConfirm();
//        if (await confirm(t.confirmDel)) { ... }
//        return <>{confirmDialog}...</>
export function useConfirm() {
  const { t } = useLang();
  const [request, setRequest] = useState(null); // { message, danger }
  const resolveRef = useRef(null);

  const confirm = useCallback((message, opts = {}) => new Promise(resolve => {
    resolveRef.current = resolve;
    setRequest({ message, danger: opts.danger !== false });
  }), []);

  function settle(result) {
    setRequest(null);
    if (resolveRef.current) {
      resolveRef.current(result);
      resolveRef.current = null;
    }
  }

  const confirmDialog = request ? (
    <div className="modal-overlay" onClick={() => settle(false)}>
      <div className="modal-box confirm-box" onClick={e => e.stopPropagation()}>
        <div className="confirm-icon" data-danger={request.danger}>
          <AlertTriangle size={22} strokeWidth={1.8} />
        </div>
        <p className="confirm-message">{request.message}</p>
        <div className="confirm-actions">
          <button type="button" className="btn btn-secondary" onClick={() => settle(false)} autoFocus>
            {t.cancel}
          </button>
          <button
            type="button"
            className={request.danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={() => settle(true)}
          >
            {request.danger ? t.del : (t.confirmYes || t.del)}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return [confirm, confirmDialog];
}
