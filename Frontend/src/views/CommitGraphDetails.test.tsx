import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../components/ThemeProvider';
import { RepoProvider, useRepo } from '../context/RepoContext';
import { CommitGraph } from './CommitGraph';

const LoadedRepoWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { setRepo } = useRepo();
  React.useEffect(() => {
    setRepo({
      repoId: 'sample-repo',
      name: 'sample-repo',
      path: '/path/to/sample-repo',
      status: 'done',
      commitCount: 42,
    });
  }, [setRepo]);

  return <>{children}</>;
};

function renderCommitGraph() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RepoProvider>
          <LoadedRepoWrapper>
            <MemoryRouter initialEntries={['/graph']}>
              <CommitGraph />
            </MemoryRouter>
          </LoadedRepoWrapper>
        </RepoProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('CommitGraph Details Panel Behavior (FIX 3)', () => {
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    // Provide non-zero dimensions in jsdom for virtual list rendering
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        bottom: 600,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => {},
      };
    };
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: 600,
    });
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('details panel is open by default when commits load', async () => {
    renderCommitGraph();

    // Wait for commits to load and first commit to be selected
    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: /close commit details panel/i })).toBeDefined();
      },
      { timeout: 5000 }
    );

    // Toggle button should NOT be in the document when panel is open
    expect(screen.queryByRole('button', { name: /show commit details/i })).toBeNull();

    // Heading "Commit Details" is present
    expect(screen.getByRole('heading', { name: 'Commit Details' })).toBeDefined();
  });

  it('clicking X closes the details panel and shows Details toggle button', async () => {
    renderCommitGraph();

    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: /close commit details panel/i })).toBeDefined();
      },
      { timeout: 5000 }
    );

    const closeBtn = screen.getByRole('button', { name: /close commit details panel/i });
    fireEvent.click(closeBtn);

    // Panel is now closed
    expect(screen.queryByRole('button', { name: /close commit details panel/i })).toBeNull();

    // Details toggle button appears with correct accessible label and aria-expanded=false
    const toggleBtn = screen.getByRole('button', { name: /show commit details/i });
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(toggleBtn.textContent).toContain('Details');

    // Layout should have panel-collapsed class
    const layout = document.querySelector('.commit-graph-layout');
    expect(layout?.classList.contains('panel-collapsed')).toBe(true);
  });

  it('clicking Details toggle reopens the panel with the same commit', async () => {
    renderCommitGraph();

    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: /close commit details panel/i })).toBeDefined();
      },
      { timeout: 5000 }
    );

    // Close the panel
    fireEvent.click(screen.getByRole('button', { name: /close commit details panel/i }));
    expect(screen.queryByRole('button', { name: /close commit details panel/i })).toBeNull();

    // Reopen using toggle button
    const toggleBtn = screen.getByRole('button', { name: /show commit details/i });
    fireEvent.click(toggleBtn);

    // Details panel is visible again
    expect(screen.getByRole('button', { name: /close commit details panel/i })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Commit Details' })).toBeDefined();

    // Toggle button is gone
    expect(screen.queryByRole('button', { name: /show commit details/i })).toBeNull();
  });

  it('selecting a different commit while panel is closed reopens it automatically', async () => {
    renderCommitGraph();

    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: /close commit details panel/i })).toBeDefined();
      },
      { timeout: 5000 }
    );

    // Close the panel
    fireEvent.click(screen.getByRole('button', { name: /close commit details panel/i }));
    expect(screen.queryByRole('button', { name: /close commit details panel/i })).toBeNull();

    // With getBoundingClientRect mocked, virtual list renders rows
    await waitFor(
      () => {
        const rows = screen.getAllByRole('row');
        expect(rows.length).toBeGreaterThan(1);
      },
      { timeout: 5000 }
    );

    const rows = screen.getAllByRole('row');
    // Click the second commit row
    fireEvent.click(rows[1]);

    // Panel reopens automatically
    expect(screen.getByRole('button', { name: /close commit details panel/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /show commit details/i })).toBeNull();
  });

  it('pressing Escape inside details panel closes it and focuses Details toggle', async () => {
    renderCommitGraph();

    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: /close commit details panel/i })).toBeDefined();
      },
      { timeout: 5000 }
    );

    const panel = await screen.findByRole(
      'region',
      { name: /details for commit/i },
      { timeout: 8000 }
    );
    fireEvent.keyDown(panel, { key: 'Escape' });

    // Panel closes
    expect(screen.queryByRole('button', { name: /close commit details panel/i })).toBeNull();

    // Toggle button is visible and receives focus
    const toggleBtn = screen.getByRole('button', { name: /show commit details/i });
    expect(toggleBtn).toBeDefined();

    await waitFor(
      () => {
        expect(document.activeElement).toBe(toggleBtn);
      },
      { timeout: 5000 }
    );
  });
});
