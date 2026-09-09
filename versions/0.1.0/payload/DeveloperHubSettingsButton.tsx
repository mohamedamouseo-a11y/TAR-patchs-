import React from 'react';
import { FiCode, FiSettings } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { Menu, MenuItem } from '@tarko/ui';

type Props = {
  variant?: 'navbar' | 'floating';
};

export const DeveloperHubSettingsButton: React.FC<Props> = ({ variant = 'navbar' }) => {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();

  const buttonClass =
    variant === 'floating'
      ? 'w-10 h-10 rounded-full flex items-center justify-center border border-gray-200/80 bg-white/90 text-gray-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
      : 'w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100/40 dark:hover:bg-gray-800/40 transition-all hover:scale-110 active:scale-95';

  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)} title="Settings" aria-label="Settings">
        <FiSettings size={variant === 'floating' ? 17 : 16} />
      </button>
      <Menu open={open} onClose={() => setOpen(false)}>
        <MenuItem
          onClick={() => {
            setOpen(false);
            navigate('/developer-hub');
          }}
        >
          <div className="flex items-center gap-2">
            <FiCode size={15} />
            <span>Developer Hub</span>
          </div>
        </MenuItem>
      </Menu>
    </>
  );
};
