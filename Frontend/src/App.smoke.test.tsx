import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './components/ThemeProvider';
import { RepoProvider, useRepo } from './context/RepoContext';
import { Header } from './components/Header';
import { NotFound } from './views/NotFound';
import { Home } from './views/Home';
import { About } from './views/About';
import { LoadRepo } from './views/LoadRepo';
import { CommitGraph } from './views/CommitGraph';
import { FileEvolution } from './views/FileEvolution';
import { Dashboard } from './views/Dashboard';
import { resetMockImportState } from './api/client';
import { STORAGE_KEY_CURRENT_REPO, STORAGE_KEY_RECENT_REPOS } from './components/load/loadUtils';

function renderWithProviders(ui: React.ReactElement, initialRoute: string = '/') {
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
            {ui}
          </MemoryRouter>
        </RepoProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

// Helper to render views with a populated loaded repository in context
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

function renderWithLoadedRepo(ui: React.ReactElement, initialRoute: string = '/') {
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
            <MemoryRouter initialEntries={[initialRoute]}>
              {ui}
            </MemoryRouter>
          </LoadedRepoWrapper>
        </RepoProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('Application Smoke Tests', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'light');
  });

  it('Header displays all five navigation destinations', () => {
    renderWithProviders(<Header />);

    // In desktop navigation
    const nav = screen.getByRole('navigation', { name: /main navigation/i });
    expect(nav).toBeDefined();

    expect(screen.getByRole('link', { name: /^home$/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /^commit graph$/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /^file evolution$/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /^dashboard$/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /^about$/i })).toBeDefined();
  });

  it('ThemeToggle flips data-theme attribute on <html> element', async () => {
    renderWithProviders(<Header />);

    const themeToggleButtons = screen.getAllByRole('button', { name: /switch to dark theme|switch to light theme/i });
    const button = themeToggleButtons[0];
    expect(button).toBeDefined();

    const initialTheme = document.documentElement.getAttribute('data-theme');
    fireEvent.click(button);

    await waitFor(() => {
      const nextTheme = document.documentElement.getAttribute('data-theme');
      expect(nextTheme).not.toBe(initialTheme);
    });
  });

  it('NotFound page shows the requested path text safely', () => {
    const testPath = '/non-existent-repository-route';
    renderWithProviders(<NotFound />, testPath);

    expect(screen.getByText('This page is not in the history')).toBeDefined();
    expect(screen.getByText(new RegExp(`Requested:\\s*${testPath}`))).toBeDefined();
    expect(screen.getByRole('link', { name: /go to home/i })).toBeDefined();
  });

  it('Home page renders without crashing', () => {
    const { container } = renderWithProviders(<Home />);
    expect(container.querySelector('h1')).toBeDefined();
    expect(screen.getByText(/See your repository's/i)).toBeDefined();
  });

  it('About page renders without crashing', () => {
    const { container } = renderWithProviders(<About />);
    expect(container.querySelector('h1')).toBeDefined();
    expect(screen.getByRole('heading', { name: /About & Limitations/i })).toBeDefined();
    expect(screen.getByRole('heading', { name: /Known Limitations/i })).toBeDefined();
  });

  it('Header includes repository status chip linking to /load', () => {
    renderWithProviders(<Header />);
    const statusLinks = screen.getAllByRole('link', { name: /repository status/i });
    expect(statusLinks.length).toBeGreaterThan(0);
    expect(statusLinks[0].getAttribute('href')).toBe('/load');
  });

  it('Load page renders, validates empty submit, and handles import completion', async () => {
    window.localStorage.clear();
    resetMockImportState('sample-repo');

    renderWithProviders(<LoadRepo />);

    // 1. Renders title and form
    expect(screen.getByRole('heading', { name: /load a repository/i })).toBeDefined();
    const input = screen.getByLabelText(/repository path/i);
    expect(input).toBeDefined();

    // 2. Empty submit shows validation error
    const submitBtn = screen.getByRole('button', { name: /start import/i });
    fireEvent.click(submitBtn);

    expect(screen.getByText('Repository path is required.')).toBeDefined();

    // 3. Fill valid path and submit
    fireEvent.change(input, { target: { value: '~/projects/gitviz' } });
    fireEvent.click(submitBtn);

    // 4. Transitions to progress and reaches done state
    await waitFor(
      () => {
        expect(screen.getByText(/import finished/i)).toBeDefined();
        expect(screen.getByRole('button', { name: /open commit graph/i })).toBeDefined();
      },
      { timeout: 7000 }
    );
  }, 12000);

  it('no repo loaded shows the EmptyState with a Load button on each of the three pages', () => {
    // 1. Commit Graph
    const graphRes = renderWithProviders(<CommitGraph />, '/graph');
    expect(graphRes.getByRole('heading', { name: 'No repository loaded' })).toBeDefined();
    expect(
      graphRes.getByText(
        'Enter the path of a local Git repository to see its commit graph, file history and health metrics.'
      )
    ).toBeDefined();
    const graphLink = graphRes.getByRole('link', { name: /load a repository/i });
    expect(graphLink.getAttribute('href')).toBe('/load');
    graphRes.unmount();

    // 2. File Evolution
    const filesRes = renderWithProviders(<FileEvolution />, '/files');
    expect(filesRes.getByRole('heading', { name: 'No repository loaded' })).toBeDefined();
    expect(
      filesRes.getByText(
        'Enter the path of a local Git repository to see its commit graph, file history and health metrics.'
      )
    ).toBeDefined();
    const filesLink = filesRes.getByRole('link', { name: /load a repository/i });
    expect(filesLink.getAttribute('href')).toBe('/load');
    filesRes.unmount();

    // 3. Health Dashboard
    const dashRes = renderWithProviders(<Dashboard />, '/dashboard');
    expect(dashRes.getByRole('heading', { name: 'No repository loaded' })).toBeDefined();
    expect(
      dashRes.getByText(
        'Enter the path of a local Git repository to see its commit graph, file history and health metrics.'
      )
    ).toBeDefined();
    const dashLink = dashRes.getByRole('link', { name: /load a repository/i });
    expect(dashLink.getAttribute('href')).toBe('/load');
    dashRes.unmount();
  });

  it('data pages show data and Load a different repository button when repo is loaded', async () => {
    // 1. Commit Graph with loaded repo
    const graphRes = renderWithLoadedRepo(<CommitGraph />, '/graph');
    await waitFor(() => {
      expect(graphRes.getByRole('button', { name: /load a different repository/i })).toBeDefined();
    });
    graphRes.unmount();

    // 2. File Evolution with loaded repo
    const filesRes = renderWithLoadedRepo(<FileEvolution />, '/files');
    await waitFor(() => {
      expect(filesRes.getByRole('button', { name: /load a different repository/i })).toBeDefined();
    });
    filesRes.unmount();

    // 3. Health Dashboard with loaded repo
    const dashRes = renderWithLoadedRepo(<Dashboard />, '/dashboard');
    await waitFor(() => {
      expect(dashRes.getByRole('button', { name: /load a different repository/i })).toBeDefined();
    });
    dashRes.unmount();
  });

  it('refresh starts with no repo (context does not restore from localStorage)', () => {
    window.localStorage.setItem(
      STORAGE_KEY_CURRENT_REPO,
      JSON.stringify({ repoId: 'leaked-session', name: 'leaked', path: '/leaked' })
    );

    const { getByRole } = renderWithProviders(<CommitGraph />, '/graph');
    expect(window.localStorage.getItem(STORAGE_KEY_CURRENT_REPO)).toBeNull();
    expect(getByRole('heading', { name: 'No repository loaded' })).toBeDefined();
  });

  it('recent chip fills input but does not load', () => {
    window.localStorage.setItem(
      STORAGE_KEY_RECENT_REPOS,
      JSON.stringify([
        {
          path: '/test/recent/repo',
          name: 'repo',
          lastLoadedAt: new Date().toISOString(),
        },
      ])
    );

    renderWithProviders(<LoadRepo />);

    const chip = screen.getByRole('listitem', { name: /\/test\/recent\/repo/i });
    expect(chip).toBeDefined();

    fireEvent.click(chip);

    const input = screen.getByLabelText(/enter the repository path/i) as HTMLInputElement;
    expect(input.value).toBe('/test/recent/repo');

    // Input is populated, but import has NOT started
    expect(screen.getByRole('button', { name: /start import/i })).toBeDefined();
    expect(screen.queryByText(/import finished/i)).toBeNull();
  });

  it('Hero includes prominent quick-start form card and secondary actions', () => {
    renderWithProviders(<Home />);

    // Input and Load Repository button inside quick start
    const quickInput = screen.getByLabelText(/repository path/i);
    expect(quickInput).toBeDefined();

    const quickSubmit = screen.getByRole('button', { name: /^load repository$/i });
    expect(quickSubmit).toBeDefined();

    // Empty validation error on submit
    fireEvent.click(quickSubmit);
    expect(screen.getByText('Repository path is required.')).toBeDefined();

    // Secondary buttons
    expect(screen.getByRole('link', { name: /open commit graph/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /view dashboard/i })).toBeDefined();
  });
});
