import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LangContext';
import { Landmark, AlertTriangle } from 'lucide-react';

export default function LoginPage() {
  const { login }                   = useAuth();
  const { t, lang, toggle }         = useLang();
  const [username, setUsername]     = useState('');
  const [password, setPassword]     = useState('');
  const [error, setError]           = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message || 'An error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const features = lang === 'ar'
    ? ['تتبع المراسلات الرسمية الصادرة والواردة', 'إدارة الاستفسارات وطلبات الجمهور', 'متابعة العقود والشيكات والبحوث الاجتماعية', 'لوحة إدارة متكاملة مع صلاحيات LDAP']
    : ['Track official inbound & outbound correspondence', 'Manage public inquiries and service requests', 'Follow up on contracts, cheques & social research', 'Full admin panel with LDAP role management'];

  return (
    <div className="login-shell">
      {/* ── Brand panel ── */}
      <div className="login-brand">
        <div className="login-brand-inner">
          <div className="login-logo-ring"><Landmark size={36} strokeWidth={1.4} /></div>
          <div className="login-org-name">{t.orgName}</div>
          <div className="login-org-sub" style={{ marginTop: '0.4rem' }}>{t.appName}</div>
          <div className="login-brand-features">
            {features.map((f, i) => (
              <div className="login-feature" key={i}>
                <div className="login-feature-dot" />
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Form panel ── */}
      <div className="login-form-side">
        <div className="login-card">
          <div className="login-lang-row">
            <div className="lang-toggle" style={{ background: '#f0f4f8', border: '1px solid #e2e8f0' }}>
              <button
                className={`lang-btn${lang === 'ar' ? ' active' : ''}`}
                style={{ color: lang === 'ar' ? '#C41E1E' : '#718096', background: lang === 'ar' ? '#fff' : 'transparent' }}
                onClick={() => lang !== 'ar' && toggle()}
                type="button"
              >
                عربي
              </button>
              <button
                className={`lang-btn${lang === 'en' ? ' active' : ''}`}
                style={{ color: lang === 'en' ? '#C41E1E' : '#718096', background: lang === 'en' ? '#fff' : 'transparent' }}
                onClick={() => lang !== 'en' && toggle()}
                type="button"
              >
                EN
              </button>
            </div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div className="login-card-title">{t.signIn}</div>
            <div className="login-card-sub" style={{ marginTop: '0.3rem' }}>
              {lang === 'ar' ? 'أدخل بيانات حساب المؤسسة' : 'Enter your corporate credentials'}
            </div>
          </div>

          {error && (
            <div className="alert alert-error" role="alert" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={15} strokeWidth={2} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="login-username">{t.username}</label>
              <input
                id="login-username"
                className="form-control"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder={t.usernamePH}
                autoComplete="username"
                required
                disabled={submitting}
                dir="ltr"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="login-password">{t.password}</label>
              <input
                id="login-password"
                className="form-control"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={submitting}
                dir="ltr"
              />
            </div>

            <button
              className="btn btn-primary"
              type="submit"
              disabled={submitting}
              style={{ marginTop: '0.25rem', padding: '0.7rem', fontSize: '0.95rem', width: '100%' }}
            >
              {submitting
                ? <><span className="spinner" style={{ width: 16, height: 16, borderTopColor: '#fff' }} />{t.signingIn}</>
                : t.signIn}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
