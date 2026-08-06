import { fireEvent, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { LoginPage } from '../pages/LoginPage.js';
import { renderWithProviders } from './test-utils.js';
import { ApiError } from '../api/client.js';

vi.mock('../api/auth.js', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  checkSession: vi.fn().mockResolvedValue({ authenticated: false }),
}));

import * as authApi from '../api/auth.js';

describe('LoginPage', () => {
  it('renders the Arabic login form', () => {
    renderWithProviders(<LoginPage />);
    expect(screen.getByLabelText('كلمة المرور')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'دخول' })).toBeInTheDocument();
  });

  it('submit button is disabled while the password field is empty', () => {
    renderWithProviders(<LoginPage />);
    expect(screen.getByRole('button', { name: 'دخول' })).toBeDisabled();
  });

  it('calls login with the entered password on submit', async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce(undefined);
    renderWithProviders(<LoginPage />);

    fireEvent.change(screen.getByLabelText('كلمة المرور'), {
      target: { value: 'correct-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'دخول' }));

    await waitFor(() => {
      // react-query v5 passes a context object as second arg to mutationFn
      expect(vi.mocked(authApi.login).mock.calls[0]?.[0]).toBe('correct-password');
    });
  });

  it('shows Arabic error for an invalid password (401)', async () => {
    vi.mocked(authApi.login).mockRejectedValueOnce(
      new ApiError(401, 'INVALID_CREDENTIALS'),
    );
    renderWithProviders(<LoginPage />);

    fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'دخول' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('كلمة المرور غير صحيحة');
    });
  });

  it('shows rate-limit message for 429 errors', async () => {
    vi.mocked(authApi.login).mockRejectedValueOnce(
      new ApiError(429, 'TOO_MANY_ATTEMPTS'),
    );
    renderWithProviders(<LoginPage />);

    fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'دخول' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('تم تجاوز الحد المسموح به');
    });
  });

  it('shows a generic Arabic error for server failures (500)', async () => {
    vi.mocked(authApi.login).mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR'));
    renderWithProviders(<LoginPage />);

    fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'test' } });
    fireEvent.click(screen.getByRole('button', { name: 'دخول' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('حدث خطأ في الخادم');
    });
  });
});
