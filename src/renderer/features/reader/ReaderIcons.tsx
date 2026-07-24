import type { ReactNode } from 'react';

const Icon = ({
  children,
  size = 20,
  className = '',
}: {
  children: ReactNode;
  size?: number;
  className?: string;
}) => (
  <svg
    aria-hidden="true"
    className={`reader-icon ${className}`.trim()}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

export const MenuIcon = () => (
  <Icon size={19}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
);

export const DocumentIcon = () => (
  <Icon>
    <path d="M6.5 3.5h7l4 4v13h-11z" />
    <path d="M13.5 3.5v4h4M9 12h6M9 16h5" />
  </Icon>
);

export const SummaryIcon = () => (
  <Icon size={18}>
    <path d="M5 5h14M5 9h14M5 13h9M5 17h11" />
  </Icon>
);

export const TranslateIcon = () => (
  <Icon size={19} className="translate-icon">
    <path d="M5 7.5h13" />
    <path d="m15 4.5 3 3-3 3" />
    <path d="M19 16.5H6" />
    <path d="m9 13.5-3 3 3 3" />
  </Icon>
);

export const InboxIcon = () => (
  <Icon>
    <path d="M4 5h16v14H4zM4 14h5l1.5 2h3L15 14h5" />
  </Icon>
);

export const StarIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg
    aria-hidden="true"
    className="reader-icon"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
  </svg>
);

export const FilterIcon = () => (
  <Icon size={17}>
    <path d="M5 7h14M8 12h8M10.5 17h3" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon size={19}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon size={18}>
    <path d="m5 12 4 4 10-10" />
  </Icon>
);

export const ReadIcon = () => (
  <Icon size={19}>
    <circle cx="12" cy="12" r="8.25" />
    <path d="m8.2 12.1 2.5 2.5 5.2-5.4" />
  </Icon>
);

export const SyncIcon = () => (
  <Icon size={18}>
    <path d="M20 8a7 7 0 0 0-12-3L6 7M6 3v4h4" />
    <path d="M4 16a7 7 0 0 0 12 3l2-2M18 21v-4h-4" />
  </Icon>
);

export const BookmarkIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg
    aria-hidden="true"
    className="reader-icon"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6.5 4.5h11v16L12 17l-5.5 3.5z" />
  </svg>
);

export const LinkIcon = () => (
  <Icon>
    <path d="m10 13 4-4" />
    <path d="M7.5 15.5 5 18a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0" transform="translate(2)" />
    <path d="m16.5 8.5 2.5-2.5a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" transform="translate(-2)" />
  </Icon>
);

export const MoreIcon = () => (
  <Icon>
    <circle cx="5" cy="12" r=".8" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r=".8" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r=".8" fill="currentColor" stroke="none" />
  </Icon>
);

export const FocusIcon = () => (
  <Icon size={20}>
    <path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" />
  </Icon>
);

export const ForwardIcon = () => (
  <Icon size={20}>
    <path d="m9.5 5 7 7-7 7M16 12H5" />
  </Icon>
);

export const SunIcon = () => (
  <Icon size={18}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 2.5v2M12 19.5v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M2.5 12h2M19.5 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4" />
  </Icon>
);

export const MoonIcon = () => (
  <Icon size={18}>
    <path d="M20 15.2A8.2 8.2 0 0 1 8.8 4a8.2 8.2 0 1 0 11.2 11.2Z" />
  </Icon>
);

export const SettingsIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3.25" />
    <path d="M19 13.4v-2.8l-2-.7a7 7 0 0 0-.7-1.7l.9-1.9-2-2-1.9.9a7 7 0 0 0-1.7-.7l-.7-2H8.1l-.7 2a7 7 0 0 0-1.7.7l-1.9-.9-2 2 .9 1.9A7 7 0 0 0 2 9.9l-2 .7v2.8l2 .7a7 7 0 0 0 .7 1.7l-.9 1.9 2 2 1.9-.9a7 7 0 0 0 1.7.7l.7 2h2.8l.7-2a7 7 0 0 0 1.7-.7l1.9.9 2-2-.9-1.9a7 7 0 0 0 .7-1.7z" />
  </Icon>
);

export const ImportIcon = () => (
  <Icon size={18}>
    <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" />
  </Icon>
);

export const EditIcon = () => (
  <Icon size={16}>
    <path d="m5 16-.8 3.8L8 19l10-10-3-3zM13.5 7.5l3 3" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon size={16}>
    <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon size={16}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);
