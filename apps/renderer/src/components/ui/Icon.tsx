import type { SVGProps } from 'react';

export type IconName =
  | 'add'
  | 'refresh'
  | 'install'
  | 'details'
  | 'remove'
  | 'uninstall'
  | 'close'
  | 'detect'
  | 'save'
  | 'cancel'
  | 'form'
  | 'yaml'
  | 'template'
  | 'dependency'
  | 'browse'
  | 'upload'
  | 'back'
  | 'settings'
  | 'console'
  | 'rollback'
  | 'copy'
  | 'confirm';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 16, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {renderIconPath(name)}
    </svg>
  );
}

function renderIconPath(name: IconName) {
  switch (name) {
    case 'add':
      return <path d="M12 5v14M5 12h14" />;
    case 'refresh':
      return (
        <>
          <path d="M21 12a9 9 0 0 1-15.5 6.4" />
          <path d="M3 12a9 9 0 0 1 15.5-6.4" />
          <path d="M3 16v2h2" />
          <path d="M21 8V6h-2" />
        </>
      );
    case 'install':
      return (
        <>
          <path d="M12 3v12" />
          <path d="M7 10l5 5 5-5" />
          <path d="M5 21h14" />
        </>
      );
    case 'details':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10v6" />
          <path d="M12 7h.01" />
        </>
      );
    case 'remove':
    case 'uninstall':
      return (
        <>
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M6 6l1 14h10l1-14" />
          <path d="M10 11v6M14 11v6" />
        </>
      );
    case 'close':
    case 'cancel':
      return (
        <>
          <path d="M18 6L6 18" />
          <path d="M6 6l12 12" />
        </>
      );
    case 'detect':
      return (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </>
      );
    case 'save':
      return (
        <>
          <path d="M5 3h12l2 2v16H5z" />
          <path d="M8 3v6h8V3" />
          <path d="M9 21v-6h6v6" />
        </>
      );
    case 'form':
      return (
        <>
          <path d="M4 6h16" />
          <path d="M4 12h8" />
          <path d="M4 18h12" />
          <circle cx="16" cy="12" r="1" />
          <circle cx="18" cy="18" r="1" />
        </>
      );
    case 'yaml':
      return (
        <>
          <path d="M8 6l4 6 4-6" />
          <path d="M12 12v6" />
          <path d="M5 19h14" />
        </>
      );
    case 'template':
      return (
        <>
          <path d="M12 3l2.2 4.5L19 9l-3.5 3.3.8 4.7L12 14.8 7.7 17l.8-4.7L5 9l4.8-1.5z" />
        </>
      );
    case 'dependency':
      return (
        <>
          <path d="M9 7H5a2 2 0 0 0 0 4h4" />
          <path d="M15 13h4a2 2 0 0 0 0-4h-4" />
          <path d="M8 12h8" />
        </>
      );
    case 'browse':
      return (
        <>
          <path d="M3 7h7l2 2h9v10H3z" />
          <path d="M12 12v6M9 15h6" />
        </>
      );
    case 'upload':
      return (
        <>
          <path d="M12 21V9" />
          <path d="M7 14l5-5 5 5" />
          <path d="M5 3h14" />
        </>
      );
    case 'back':
      return (
        <>
          <path d="M19 12H5" />
          <path d="M11 18l-6-6 6-6" />
        </>
      );
    case 'settings':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2H9a1 1 0 0 0 .6-.9V4a2 2 0 1 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1V9c0 .4.2.7.6.9H20a2 2 0 1 1 0 4h-.2a1 1 0 0 0-.9.6z" />
        </>
      );
    case 'console':
      return (
        <>
          <path d="M4 5h16v14H4z" />
          <path d="M8 10l2 2-2 2" />
          <path d="M12 16h4" />
        </>
      );
    case 'rollback':
      return (
        <>
          <path d="M3 7v6h6" />
          <path d="M3 13a9 9 0 1 0 3-6.7L3 9" />
        </>
      );
    case 'copy':
      return (
        <>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <rect x="4" y="4" width="11" height="11" rx="2" />
        </>
      );
    case 'confirm':
      return <path d="M20 6L9 17l-5-5" />;
    default:
      return <circle cx="12" cy="12" r="9" />;
  }
}
