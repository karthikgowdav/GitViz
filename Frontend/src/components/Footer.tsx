import React from 'react';
import { Link } from 'react-router-dom';
import {
  GitBranch,
  ExternalLink,
  Users,
  AlertTriangle,
  Cpu,
  ArrowUp,
  Home,
  FolderGit2,
  FileClock,
  Activity,
  BookOpen,
  Palette,
  Github,
} from 'lucide-react';
import { PROJECT_REPO_URL } from '../content/links';
import { USE_MOCK } from '../api/client';
import './Footer.css';

export const Footer: React.FC = () => {
  const scrollToTop = () => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  };

  return (
    <footer className="site-footer" role="contentinfo">
      <div className="footer-container">
        {/* 4-Column Layout */}
        <div className="footer-grid">
          {/* Column 1: Brand */}
          <div className="footer-col footer-brand">
            <Link to="/" className="footer-logo" aria-label="GitViz Homepage">
              <div className="footer-logo-icon" aria-hidden="true">
                <GitBranch size={18} strokeWidth={2.4} />
              </div>
              <span className="footer-logo-text">GitViz</span>
            </Link>

            <p className="footer-brand-desc">
              A free, open-source Git analytics and evolution visualizer.
              Runs locally and reads your repository without changing it.
            </p>

            <a
              href={PROJECT_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="footer-brand-github-btn"
              aria-label="Star / View on GitHub (opens in a new tab)"
            >
              <Github size={15} aria-hidden="true" />
              <span>Star / View on GitHub</span>
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          </div>

          {/* Column 2: Explore Navigation */}
          <div className="footer-col">
            <h4 className="footer-heading">Explore</h4>
            <nav aria-label="Explore navigation">
              <ul className="footer-nav-list">
                <li>
                  <Link to="/load" className="footer-link">
                    <FolderGit2 size={16} className="footer-link-icon" aria-hidden="true" />
                    <span>Load Repository</span>
                  </Link>
                </li>
                <li>
                  <Link to="/" className="footer-link">
                    <Home size={16} className="footer-link-icon" aria-hidden="true" />
                    <span>Home</span>
                  </Link>
                </li>
                <li>
                  <Link to="/graph" className="footer-link">
                    <GitBranch size={16} className="footer-link-icon" aria-hidden="true" />
                    <span>Commit Graph</span>
                  </Link>
                </li>
                <li>
                  <Link to="/files" className="footer-link">
                    <FileClock size={16} className="footer-link-icon" aria-hidden="true" />
                    <span>File Evolution</span>
                  </Link>
                </li>
                <li>
                  <Link to="/dashboard" className="footer-link">
                    <Activity size={16} className="footer-link-icon" aria-hidden="true" />
                    <span>Dashboard</span>
                  </Link>
                </li>
              </ul>
            </nav>
          </div>

          {/* Column 3: Project Navigation */}
          <div className="footer-col">
            <h4 className="footer-heading">Project</h4>
            <nav aria-label="Project navigation">
              <ul className="footer-nav-list">
                <li>
                  <Link to="/about" className="footer-link">
                    <BookOpen size={16} className="footer-link-icon" aria-hidden="true" />
                    <span>About &amp; Limitations</span>
                  </Link>
                </li>
                <li>
                  <Link to="/design-system" className="footer-link">
                    <Palette size={16} className="footer-link-icon" aria-hidden="true" />
                    <span>Design System</span>
                  </Link>
                </li>
                <li>
                  <a
                    href={PROJECT_REPO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="footer-link"
                    aria-label="GitHub repository (opens in a new tab)"
                  >
                    <Github size={16} className="footer-link-icon" aria-hidden="true" />
                    <span>GitHub repository</span>
                    <ExternalLink size={13} aria-hidden="true" className="footer-external-icon" />
                  </a>
                </li>
              </ul>
            </nav>
          </div>

          {/* Column 4: Honest by Design */}
          <div className="footer-col">
            <h4 className="footer-heading">Honest by design</h4>
            <ul className="footer-notes-list">
              <li className="footer-note-item">
                <Users size={15} className="footer-note-icon" aria-hidden="true" />
                <span>Bus factor is an estimate</span>
              </li>
              <li className="footer-note-item">
                <AlertTriangle size={15} className="footer-note-icon" aria-hidden="true" />
                <span>Churn means inspect this, not this will break</span>
              </li>
              <li className="footer-note-item">
                <Cpu size={15} className="footer-note-icon" aria-hidden="true" />
                <span>Numbers computed from Git, not guessed</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="footer-bottom-bar">
          <div className="footer-copyright-group">
            <p className="footer-copyright">
              &copy; 2026 GitViz. Built as a college project.
            </p>
            {USE_MOCK && (
              <span className="footer-mock-indicator" title="Application is currently reading mock JSON data">
                Mock data
              </span>
            )}
          </div>

          <div className="footer-bottom-actions">
            <button
              type="button"
              onClick={scrollToTop}
              className="back-to-top-btn"
              aria-label="Back to top of page"
              title="Back to top"
            >
              <ArrowUp size={14} aria-hidden="true" />
              <span>Back to top</span>
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
};
