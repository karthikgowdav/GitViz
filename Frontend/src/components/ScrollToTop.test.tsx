import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, useNavigate, useLocation } from 'react-router-dom';
import { ScrollToTop } from './ScrollToTop';

// Helper component to trigger navigations inside MemoryRouter
const NavigationTestHarness: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div>
      <span data-testid="current-pathname">{location.pathname}</span>
      <span data-testid="current-search">{location.search}</span>
      <span data-testid="current-hash">{location.hash}</span>

      <button onClick={() => navigate('/dashboard')}>Go to Dashboard</button>
      <button onClick={() => navigate('/files?path=src/core/router.ts')}>
        Go to Files with Query
      </button>
      <button onClick={() => navigate('/files?path=src/api/client.ts')}>
        Update Query Only
      </button>
      <button onClick={() => navigate('/about#team')}>Go to About Team Hash</button>
      <button onClick={() => navigate(-1)}>Go Back</button>
    </div>
  );
};

describe('ScrollToTop component', () => {
  const originalScrollTo = window.scrollTo;

  beforeEach(() => {
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    window.scrollTo = originalScrollTo;
    vi.restoreAllMocks();
  });

  it('scrolls to (0, 0) on pathname change when navigating to a new route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <ScrollToTop />
        <NavigationTestHarness />
      </MemoryRouter>
    );

    // Initial mount does not scroll to top unless forced
    vi.clearAllMocks();

    act(() => {
      screen.getByText('Go to Dashboard').click();
    });

    expect(screen.getByTestId('current-pathname').textContent).toBe('/dashboard');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('does NOT scroll when only query string changes on the same pathname', () => {
    render(
      <MemoryRouter initialEntries={['/files?path=src/core/router.ts']}>
        <ScrollToTop />
        <NavigationTestHarness />
      </MemoryRouter>
    );

    vi.clearAllMocks();

    act(() => {
      screen.getByText('Update Query Only').click();
    });

    expect(screen.getByTestId('current-pathname').textContent).toBe('/files');
    expect(screen.getByTestId('current-search').textContent).toBe('?path=src/api/client.ts');
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls to element when URL has a hash', () => {
    // Setup mock element in document
    const teamElement = document.createElement('div');
    teamElement.id = 'team';
    teamElement.scrollIntoView = vi.fn();
    document.body.appendChild(teamElement);

    render(
      <MemoryRouter initialEntries={['/']}>
        <ScrollToTop />
        <NavigationTestHarness />
      </MemoryRouter>
    );

    vi.clearAllMocks();

    act(() => {
      screen.getByText('Go to About Team Hash').click();
    });

    expect(screen.getByTestId('current-pathname').textContent).toBe('/about');
    expect(screen.getByTestId('current-hash').textContent).toBe('#team');
    expect(teamElement.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto' });
    expect(window.scrollTo).not.toHaveBeenCalled();

    document.body.removeChild(teamElement);
  });

  it('does NOT force scroll to top on Back navigation (POP)', () => {
    render(
      <MemoryRouter initialEntries={['/', '/dashboard']}>
        <ScrollToTop />
        <NavigationTestHarness />
      </MemoryRouter>
    );

    vi.clearAllMocks();

    act(() => {
      screen.getByText('Go Back').click();
    });

    expect(screen.getByTestId('current-pathname').textContent).toBe('/');
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
