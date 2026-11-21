import React from 'react';
import './SectionHeading.css';

export interface SectionHeadingProps {
  eyebrow?: string;
  eyebrowIcon?: React.ReactNode;
  title: string;
  subtitle?: string;
  align?: 'center' | 'left';
  className?: string;
  id?: string;
  as?: 'h1' | 'h2' | 'h3';
}

export const SectionHeading: React.FC<SectionHeadingProps> = ({
  eyebrow,
  eyebrowIcon,
  title,
  subtitle,
  align = 'center',
  className = '',
  id,
  as = 'h2',
}) => {
  const HeadingTag = as;

  return (
    <div className={`section-heading section-heading-${align} ${className}`.trim()}>
      {eyebrow && (
        <span className="section-eyebrow">
          {eyebrowIcon && (
            <span className="section-eyebrow-icon" aria-hidden="true">
              {eyebrowIcon}
            </span>
          )}
          <span>{eyebrow}</span>
        </span>
      )}
      <HeadingTag id={id} className="section-title">
        {title}
      </HeadingTag>
      {subtitle && <p className="section-subtitle">{subtitle}</p>}
    </div>
  );
};
