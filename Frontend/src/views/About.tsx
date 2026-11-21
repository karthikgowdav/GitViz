import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRight,
  GitGraph,
  History,
  LayoutDashboard,
  ShieldCheck,
  Info,
  AlertTriangle,
  HelpCircle,
  Users,
  Github,
  ExternalLink,
  GitBranch,
  BarChart2,
} from 'lucide-react';
import {
  projectInfo,
  limitations,
  faqList,
  privacyPoints,
  teamRoles,
  lastReviewedDate,
} from '../content/about';
import { PROJECT_REPO_URL } from '../content/links';
import { usePageTitle } from '../hooks/usePageTitle';
import { resolveHashToLimitationId } from '../components/about/aboutUtils';
import { TableOfContents, TocSection } from '../components/about/TableOfContents';
import { LimitationList } from '../components/about/LimitationList';
import { FaqAccordion } from '../components/about/FaqAccordion';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import './About.css';

const TOC_SECTIONS: TocSection[] = [
  { id: 'overview', label: 'Overview', icon: <Info size={14} /> },
  { id: 'limitations', label: 'Known Limitations', icon: <AlertTriangle size={14} /> },
  { id: 'faq', label: 'FAQ', icon: <HelpCircle size={14} /> },
  { id: 'privacy', label: 'Privacy & Security', icon: <ShieldCheck size={14} /> },
  { id: 'team', label: 'Team & Roles', icon: <Users size={14} /> },
];

export const About: React.FC = () => {
  usePageTitle('About & Limitations');
  const location = useLocation();
  const [highlightLimitationId, setHighlightLimitationId] = useState<string | null>(null);

  // Handle hash scrolling on page mount or URL hash change
  useEffect(() => {
    const rawHash = location.hash;
    if (!rawHash) return;

    // Check if hash maps to a limitation
    const resolvedLimitation = resolveHashToLimitationId(rawHash, limitations);
    if (resolvedLimitation) {
      setHighlightLimitationId(resolvedLimitation);
    }

    // Scroll to the targeted element
    const targetId = resolvedLimitation || rawHash.replace(/^#/, '');
    const element = document.getElementById(targetId);
    if (element) {
      const prefersReducedMotion =
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // Small delay to ensure child cards have rendered
      setTimeout(() => {
        element.scrollIntoView({
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
          block: 'start',
        });
      }, 100);
    }
  }, [location.hash]);

  // Fade-in on scroll animation respecting prefers-reduced-motion
  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
    const prefersReducedMotion =
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      document.querySelectorAll('.about-section').forEach((el) => {
        el.classList.add('is-visible');
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
          }
        });
      },
      { threshold: 0.1 }
    );

    document.querySelectorAll('.about-section').forEach((el) => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div className="about-view">
      <div className="about-container">
        {/* Page Header */}
        <header className="about-header">
          <div className="about-heading-row">
            <h1 className="about-title">About &amp; Limitations</h1>
            <Badge variant="info" className="about-badge">
              <ShieldCheck size={14} aria-hidden="true" />
              <span>Honest by design</span>
            </Badge>
          </div>
          <p className="about-subtitle">
            What GitViz does, what it does not do, and where the numbers can mislead you.
          </p>
        </header>

        {/* Layout Grid: Sticky TOC on Left, Long-form Content on Right */}
        <div className="about-layout">
          <aside className="about-sidebar">
            <TableOfContents sections={TOC_SECTIONS} />
          </aside>

          <main className="about-content">
            {/* 1. OVERVIEW */}
            <section id="overview" className="about-section" aria-labelledby="heading-overview">
              <h2 id="heading-overview" className="about-section-title">
                <Info size={20} className="section-title-icon" aria-hidden="true" />
                <span>Overview</span>
              </h2>
              <p className="about-text-lead">{projectInfo.description}</p>

              <div className="overview-stack-group">
                <span className="overview-stack-label">Built with:</span>
                <div className="overview-stack-badges">
                  {projectInfo.stack.map((tech) => (
                    <Badge key={tech} variant="neutral">
                      {tech}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="overview-screen-cards">
                <Link to="/graph" className="screen-card">
                  <div className="screen-card-icon">
                    <GitGraph size={20} />
                  </div>
                  <div className="screen-card-info">
                    <div className="screen-card-title-row">
                      <span className="screen-card-title">Commit Graph</span>
                      <ArrowRight size={14} className="screen-card-arrow" />
                    </div>
                    <p className="screen-card-desc">
                      Virtualized commit DAG with greedy branch lane heuristics and merge lines.
                    </p>
                  </div>
                </Link>

                <Link to="/files" className="screen-card">
                  <div className="screen-card-icon">
                    <History size={20} />
                  </div>
                  <div className="screen-card-info">
                    <div className="screen-card-title-row">
                      <span className="screen-card-title">File Evolution</span>
                      <ArrowRight size={14} className="screen-card-arrow" />
                    </div>
                    <p className="screen-card-desc">
                      File touch history and syntax-colored unified diffs with rename break notices.
                    </p>
                  </div>
                </Link>

                <Link to="/dashboard" className="screen-card">
                  <div className="screen-card-icon">
                    <LayoutDashboard size={20} />
                  </div>
                  <div className="screen-card-info">
                    <div className="screen-card-title-row">
                      <span className="screen-card-title">Health Dashboard</span>
                      <ArrowRight size={14} className="screen-card-arrow" />
                    </div>
                    <p className="screen-card-desc">
                      Top-10 churn hotspots, estimated bus factor concentration, and CSV snapshot export.
                    </p>
                  </div>
                </Link>
              </div>
            </section>

            {/* 2. KNOWN LIMITATIONS */}
            <section id="limitations" className="about-section" aria-labelledby="heading-limitations">
              <h2 id="heading-limitations" className="about-section-title">
                <AlertTriangle size={20} className="section-title-icon" aria-hidden="true" />
                <span>Known Limitations</span>
              </h2>
              <p className="about-section-desc">
                Honesty beats a fake-perfect history. Here are the boundaries where Git heuristics,
                statistical estimates, and browser limits apply.
              </p>
              <LimitationList items={limitations} highlightId={highlightLimitationId} />
            </section>

            {/* 3. FAQ */}
            <section id="faq" className="about-section" aria-labelledby="heading-faq">
              <h2 id="heading-faq" className="about-section-title">
                <HelpCircle size={20} className="section-title-icon" aria-hidden="true" />
                <span>Frequently Asked Questions</span>
              </h2>
              <p className="about-section-desc">
                Straightforward, factual answers about GitViz and its place alongside other developer tools.
              </p>
              <FaqAccordion items={faqList} />
            </section>

            {/* 4. PRIVACY & SECURITY */}
            <section id="privacy" className="about-section" aria-labelledby="heading-privacy">
              <h2 id="heading-privacy" className="about-section-title">
                <ShieldCheck size={20} className="section-title-icon" aria-hidden="true" />
                <span>Privacy &amp; Security</span>
              </h2>
              <Card className="privacy-card">
                <div className="privacy-card-header">
                  <ShieldCheck size={22} className="privacy-icon" aria-hidden="true" />
                  <h3 className="privacy-card-title">Your code never leaves your computer</h3>
                </div>
                <div className="privacy-points-grid">
                  {privacyPoints.map((point) => (
                    <div key={point.title} className="privacy-point-item">
                      <strong className="privacy-point-title">{point.title}</strong>
                      <p className="privacy-point-desc">{point.description}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </section>

            {/* 5. TEAM & ROLES */}
            <section id="team" className="about-section" aria-labelledby="heading-team">
              <div className="team-section-header">
                <div>
                  <h2 id="heading-team" className="about-section-title">
                    <Users size={20} className="section-title-icon" aria-hidden="true" />
                    <span>Team &amp; Roles</span>
                  </h2>
                  <p className="about-section-desc">
                    Built as a collaborative multi-role engineering project with distinct domain boundaries.
                  </p>
                </div>
                <a
                  href={PROJECT_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-md team-repo-btn"
                  aria-label="View project on GitHub (opens in a new tab)"
                >
                  <Github size={16} aria-hidden="true" />
                  <span>View project on GitHub</span>
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              </div>
              <div className="team-grid">
                {teamRoles.map((role) => (
                  <Card key={role.name} className="team-role-card">
                    <div className="team-role-header">
                      <div
                        className="team-avatar"
                        style={{ backgroundColor: role.laneColor }}
                        aria-hidden="true"
                      >
                        {role.initials}
                      </div>
                      <div className="team-role-meta">
                        <div className="team-member-name-row">
                          <h3 className="team-member-name">{role.name}</h3>
                          <Badge variant="neutral" className="team-role-badge">
                            {role.role}
                          </Badge>
                        </div>
                        <span className="team-role-area">{role.area}</span>
                      </div>
                    </div>
                    <p className="team-role-desc">{role.description}</p>
                    {role.github && (
                      <div className="team-github-row">
                        <a
                          href={`https://github.com/${role.github}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="team-github-link"
                          aria-label={`${role.name}'s GitHub profile (opens in a new tab)`}
                        >
                          <Github size={14} aria-hidden="true" />
                          <span>@{role.github}</span>
                          <ExternalLink size={12} aria-hidden="true" />
                        </a>
                      </div>
                    )}
                  </Card>
                ))}
              </div>

              <div className="review-footer-note">
                <span>Content last reviewed: {lastReviewedDate}.</span>{' '}
                <span className="review-feedback-prompt">
                  Found something inaccurate? Tell the team.
                </span>
              </div>
            </section>

            {/* 6. CALL TO ACTION CARD */}
            <Card className="about-cta-card">
              <div className="about-cta-text">
                <h3 className="about-cta-title">Ready to explore?</h3>
                <p className="about-cta-desc">
                  Open your repository history and explore the commit graph or health dashboard.
                </p>
              </div>
              <div className="about-cta-buttons">
                <Button variant="primary" size="md" to="/graph">
                  <GitBranch size={16} aria-hidden="true" />
                  <span>Open Commit Graph</span>
                </Button>
                <Button variant="secondary" size="md" to="/dashboard">
                  <BarChart2 size={16} aria-hidden="true" />
                  <span>View Dashboard</span>
                </Button>
              </div>
            </Card>
          </main>
        </div>
      </div>
    </div>
  );
};

export default About;
