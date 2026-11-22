import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderGit2 } from 'lucide-react';
import { useRepo } from '../../context/RepoContext';
import { Button } from './Button';
import './ChangeRepoButton.css';

export interface ChangeRepoButtonProps {
  className?: string;
}

export const ChangeRepoButton: React.FC<ChangeRepoButtonProps> = ({ className = '' }) => {
  const navigate = useNavigate();
  const { clearRepo } = useRepo();

  const handleClick = () => {
    clearRepo();
    navigate('/load', { state: { fresh: true } });
  };

  return (
    <Button
      variant="secondary"
      size="md"
      onClick={handleClick}
      leadingIcon={<FolderGit2 size={16} aria-hidden="true" />}
      className={`change-repo-btn ${className}`.trim()}
      aria-label="Load a different repository"
    >
      Load a different repository
    </Button>
  );
};

export default ChangeRepoButton;
