import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';
import './IconButton.css';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  label: string;
  iconSize?: number;
}

export function IconButton({
  icon,
  label,
  iconSize = 16,
  className,
  title,
  'aria-label': ariaLabel,
  ...props
}: IconButtonProps) {
  const mergedClassName = className ? `${className} icon-button-only` : 'icon-button-only';

  return (
    <button
      className={mergedClassName}
      title={title || label}
      aria-label={ariaLabel || label}
      {...props}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}
