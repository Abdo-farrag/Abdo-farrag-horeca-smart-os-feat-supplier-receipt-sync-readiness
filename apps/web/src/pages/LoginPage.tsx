import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { login } from '../api/auth.js';
import { ApiError } from '../api/client.js';

function getArabicError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.code === 'INVALID_CREDENTIALS') {
      return 'كلمة المرور غير صحيحة. يرجى المحاولة مرة أخرى.';
    }
    if (error.status === 429 || error.code === 'TOO_MANY_ATTEMPTS') {
      return 'تم تجاوز الحد المسموح به من المحاولات. يرجى الانتظار والمحاولة لاحقاً.';
    }
  }
  return 'حدث خطأ في الخادم. يرجى المحاولة مرة أخرى.';
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      navigate('/', { replace: true });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    mutation.mutate(password);
  }

  return (
    <div className="login-page" dir="rtl">
      <div className="login-card">
        <div className="login-card__header">
          <h1 className="login-card__title">Horeca Smart OS</h1>
          <p className="login-card__subtitle">نظام إدارة المشتريات</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-form__field">
            <label htmlFor="password" className="login-form__label">
              كلمة المرور
            </label>
            <input
              id="password"
              type="password"
              className="login-form__input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={mutation.isPending}
              aria-describedby={mutation.isError ? 'login-error' : undefined}
              aria-invalid={mutation.isError ? 'true' : undefined}
            />
          </div>

          {mutation.isError && (
            <div
              id="login-error"
              className="login-form__error"
              role="alert"
              aria-live="assertive"
            >
              {getArabicError(mutation.error)}
            </div>
          )}

          <button
            type="submit"
            className="login-form__btn"
            disabled={mutation.isPending || !password}
          >
            {mutation.isPending ? 'جاري الدخول...' : 'دخول'}
          </button>
        </form>
      </div>
    </div>
  );
}
