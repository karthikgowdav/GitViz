import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * ScrollToTop
 * Automatically manages scroll position across route changes:
 * - On every pathname change, scrolls instantly to the top (window.scrollTo(0, 0)).
 * - If the URL has a hash (e.g. /about#team), scrolls to that element instead.
 * - When navigating Back/Forward (navigationType === 'POP'), does NOT force the top.
 * - Does NOT fire on query-string-only changes (e.g. /files?path=...).
 * - Preserves existing heading focus management and skip link.
 */
export const ScrollToTop: React.FC = () => {
  const location = useLocation();
  const navType = useNavigationType();
  const prevPathnameRef = useRef<string>(location.pathname);
  const isInitialMount = useRef<boolean>(true);

  useEffect(() => {
    // Initial mount handling
    if (isInitialMount.current) {
      isInitialMount.current = false;
      if (location.hash) {
        const targetId = location.hash.replace(/^#/, '');
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'auto' });
        }
      }
      return;
    }

    // Do not fire on query-string-only or hash-only changes if pathname hasn't changed
    if (prevPathnameRef.current === location.pathname) {
      return;
    }

    prevPathnameRef.current = location.pathname;

    // When navigating Back/Forward (POP), do not force scroll to top
    if (navType === 'POP') {
      return;
    }

    // If URL has a hash, scroll to that element instead
    if (location.hash) {
      const targetId = location.hash.replace(/^#/, '');
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'auto' });
        return;
      }
    }

    // Default: scroll to top instantly (no smooth scrolling)
    window.scrollTo(0, 0);
  }, [location.pathname, location.hash, navType]);

  return null;
};

export default ScrollToTop;
