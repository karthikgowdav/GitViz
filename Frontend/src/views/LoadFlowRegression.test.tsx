import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../components/ThemeProvider';
import { RepoProvider, useRepo } from '../context/RepoContext';
import { Header } from '../components/Header';
import { LoadRepo } from './LoadRepo';
import { CommitGraph } from './CommitGraph';
import { FileEvolution } from './FileEvolution';
import { Dashboard } from './Dashboard';
import { resetMockImportState } from '../api/client';

function renderFullApp(initialRoute: string = '/load') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RepoProvider>
          <MemoryRouter initialEntries={[initialRoute]}>
            <Header />
            <main>
              <Routes>
                <Route path="/load" element={<LoadRepo />} />
                <Route path="/graph" element={<CommitGraph />} />
                <Route path="/files" element={<FileEvolution />} />
                <Route path="/dashboard" element={<Dashboard />} />
              </Routes>
            </main>
          </MemoryRouter>
        </RepoProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('Load Flow Regressions (BUG 1, 2, 3, 4)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetMockImportState('sample-repo');
    window.scrollTo = vi.fn();

    class MockResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  it('progress starts at 0% on a second or later import and never jumps backward (BUG 1)', async () => {
    renderFullApp('/load');

    // --- First import ---
    const input = screen.getByLabelText(/repository path/i);
    fireEvent.change(input, { target: { value: '~/projects/first-repo' } });
    fireEvent.click(screen.getByRole('button', { name: /start import/i }));

    // Wait for first import to finish completely
    await waitFor(
      () => {
        expect(screen.getByText(/import finished/i)).toBeDefined();
      },
      { timeout: 7000 }
    );

    // --- Second import: click Header "Load Repository" button to get fresh form ---
    const headerLoadBtn = screen.getByRole('button', { name: /^load repository$/i });
    fireEvent.click(headerLoadBtn);

    // Form is now visible with empty input
    await waitFor(() => {
      const input2 = screen.getByLabelText(/repository path/i) as HTMLInputElement;
      expect(input2.value).toBe('');
    });

    const input2 = screen.getByLabelText(/repository path/i);
    // Start second import with a different path
    fireEvent.change(input2, { target: { value: '~/projects/second-repo' } });
    fireEvent.click(screen.getByRole('button', { name: /start import/i }));

    // As soon as progress begins, assert that it starts at 0% with step "Queued", NOT 100%!
    await waitFor(() => {
      expect(screen.getByText('0%')).toBeDefined();
      expect(screen.getByText('Queued')).toBeDefined();
    });
    expect(screen.queryByText(/import finished/i)).toBeNull();

    // Then let it advance forward monotonically to 100%
    await waitFor(
      () => {
        expect(screen.getByText(/import finished/i)).toBeDefined();
      },
      { timeout: 7000 }
    );
  }, 15000);

  it('runs the full load -> graph -> files -> dashboard flow 6 times in a row without breaking (BUG 2)', async () => {
    const TestNavigator: React.FC = () => {
      const { repo } = useRepo();
      return (
        <nav aria-label="Test Nav">
          <Link to="/load">Nav Load</Link>
          <Link to="/graph">Nav Graph</Link>
          <Link to="/files">Nav Files</Link>
          <Link to="/dashboard">Nav Dashboard</Link>
          <span data-testid="repo-status-indicator">{repo?.status || 'none'}</span>
        </nav>
      );
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RepoProvider>
            <MemoryRouter initialEntries={['/load']}>
              <TestNavigator />
              <Header />
              <Routes>
                <Route path="/load" element={<LoadRepo />} />
                <Route path="/graph" element={<CommitGraph />} />
                <Route path="/files" element={<FileEvolution />} />
                <Route path="/dashboard" element={<Dashboard />} />
              </Routes>
            </MemoryRouter>
          </RepoProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );

    const testPaths = [
      '~/projects/repo-one',
      'C:\\Users\\dev\\repo-two',
      '~/projects/REPO-ONE', // test different capitalization
      '~/projects/repo-four',
      'C:\\Users\\dev\\repo-five',
      '~/projects/repo-six',
    ];

    for (let i = 0; i < testPaths.length; i++) {
      const path = testPaths[i];

      // Navigate to /load
      fireEvent.click(screen.getByText('Nav Load'));

      // If finished progress card from previous run is showing, click Header Load button to get fresh form
      const headerLoadBtn = screen.getByRole('button', { name: /^load repository$/i });
      fireEvent.click(headerLoadBtn);

      await waitFor(() => {
        const inp = screen.getByLabelText(/repository path/i) as HTMLInputElement;
        expect(inp.value).toBe('');
      });

      const input = screen.getByLabelText(/repository path/i);
      fireEvent.change(input, { target: { value: path } });
      fireEvent.click(screen.getByRole('button', { name: /start import/i }));

      // Assert progress starts at 0%
      await waitFor(() => {
        expect(screen.getByText('0%')).toBeDefined();
      });

      // Wait for import to complete
      await waitFor(
        () => {
          expect(screen.getByText(/import finished/i)).toBeDefined();
        },
        { timeout: 7000 }
      );

      // Verify Context status is done
      expect(screen.getByTestId('repo-status-indicator').textContent).toBe('done');

      // 1. Verify Commit Graph renders real data, NOT "No repository loaded"
      fireEvent.click(screen.getByText('Nav Graph'));
      await waitFor(
        () => {
          expect(screen.queryByRole('heading', { name: 'No repository loaded' })).toBeNull();
          expect(screen.getByRole('heading', { name: 'Commit Graph' })).toBeDefined();
        },
        { timeout: 8000 }
      );

      // 2. Verify File Evolution renders real data
      fireEvent.click(screen.getByText('Nav Files'));
      await waitFor(
        () => {
          expect(screen.queryByRole('heading', { name: 'No repository loaded' })).toBeNull();
          expect(screen.getByRole('heading', { name: 'Inspect how any file changed over time' })).toBeDefined();
        },
        { timeout: 8000 }
      );

      // 3. Verify Health Dashboard renders real data
      fireEvent.click(screen.getByText('Nav Dashboard'));
      await waitFor(
        () => {
          expect(screen.queryByRole('heading', { name: 'No repository loaded' })).toBeNull();
          expect(screen.getByRole('heading', { name: 'Health Dashboard' })).toBeDefined();
        },
        { timeout: 8000 }
      );
    }
  }, 60000);

  it('shows current repository card and "Clear and load another" resets the view (BUG 3)', async () => {
    renderFullApp('/load');

    // 1. Load a repo
    const input = screen.getByLabelText(/repository path/i);
    fireEvent.change(input, { target: { value: '~/projects/demo-repo' } });
    fireEvent.click(screen.getByRole('button', { name: /start import/i }));

    await waitFor(
      () => {
        expect(screen.getByText(/import finished/i)).toBeDefined();
      },
      { timeout: 7000 }
    );

    // 2. Reset progress view to show current repo card
    const headerBtn = screen.getByRole('button', { name: /^load repository$/i });
    fireEvent.click(headerBtn);

    // Current repository card is displayed at top
    await waitFor(() => {
      expect(screen.getByText('Current Repository')).toBeDefined();
      expect(screen.getByRole('heading', { name: 'demo-repo' })).toBeDefined();
      expect(screen.getByText('Loading a new repository replaces the current one.')).toBeDefined();
    });

    // "Clear and load another" button is present
    const clearAndLoadAnotherBtn = screen.getByRole('button', { name: /clear and load another/i });
    expect(clearAndLoadAnotherBtn).toBeDefined();

    // 3. Click "Clear and load another"
    fireEvent.click(clearAndLoadAnotherBtn);

    // Current repository card is removed
    await waitFor(() => {
      expect(screen.queryByText('Current Repository')).toBeNull();
    });

    // Input is empty and focused
    await waitFor(() => {
      const emptyInput = screen.getByLabelText(/repository path/i) as HTMLInputElement;
      expect(emptyInput.value).toBe('');
      expect(document.activeElement).toBe(emptyInput);
    });

    // Progress view is completely cleared
    expect(screen.queryByText(/import finished/i)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  }, 15000);

  it('input Clear (X) button empties the input and resets progress view (BUG 3)', async () => {
    renderFullApp('/load');

    const input = screen.getByLabelText(/repository path/i);
    fireEvent.change(input, { target: { value: '~/projects/some-path' } });

    // The small Clear (X) button inside the input wrap
    const clearInputBtn = screen.getByRole('button', { name: /clear path input/i });
    expect(clearInputBtn).toBeDefined();

    fireEvent.click(clearInputBtn);
    await waitFor(() => {
      const currentInput = screen.getByLabelText(/repository path/i) as HTMLInputElement;
      expect(currentInput.value).toBe('');
      expect(document.activeElement).toBe(currentInput);
    });
  });

  it('failed second import keeps the previously loaded repo active (BUG 3)', async () => {
    renderFullApp('/load');

    // 1. Load initial good repo
    const input = screen.getByLabelText(/repository path/i);
    fireEvent.change(input, { target: { value: '~/projects/stable-repo' } });
    fireEvent.click(screen.getByRole('button', { name: /start import/i }));

    await waitFor(
      () => {
        expect(screen.getByText(/import finished/i)).toBeDefined();
      },
      { timeout: 7000 }
    );

    // 2. Open fresh entry
    const headerBtn = screen.getByRole('button', { name: /^load repository$/i });
    fireEvent.click(headerBtn);

    // 3. Attempt to load a path that fails ('/does/not/exist')
    await waitFor(() => {
      const inp2 = screen.getByLabelText(/repository path/i) as HTMLInputElement;
      expect(inp2.value).toBe('');
    });

    const input2 = screen.getByLabelText(/repository path/i);
    fireEvent.change(input2, { target: { value: '/does/not/exist' } });
    fireEvent.click(screen.getByRole('button', { name: /start import/i }));

    // Error alert is shown
    await waitFor(() => {
      expect(screen.getByText(/path not found or not a git repository/i)).toBeDefined();
    });

    // Notice: stable-repo remains active in context and in the current repository card!
    expect(screen.getByText('Current Repository')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'stable-repo' })).toBeDefined();
    expect(screen.getAllByText(/stable-repo/i).length).toBeGreaterThanOrEqual(1);
  }, 15000);

  it('clicking Header "Load Repository" while already on /load resets the form (BUG 4)', async () => {
    renderFullApp('/load');

    const input = screen.getByLabelText(/repository path/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '~/partial/typed/path' } });
    expect(input.value).toBe('~/partial/typed/path');

    // Click header "Load Repository" button while staying on /load
    const headerBtn = screen.getByRole('button', { name: /^load repository$/i });
    fireEvent.click(headerBtn);

    // Form is reset, input is emptied and focused
    await waitFor(() => {
      const currentInput = screen.getByLabelText(/repository path/i) as HTMLInputElement;
      expect(currentInput.value).toBe('');
      expect(document.activeElement).toBe(currentInput);
    });
  });
});
