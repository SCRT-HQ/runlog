import { Button } from "../ui/Button.tsx";

const paths = {
  packs: "M4 4h6v7H4z M14 4h6v7h-6z M4 15h6v5H4z M14 15h6v5h-6z",
  create: "m4 16-1 5 5-1L20 8l-4-4L4 16Z M13 7l4 4",
  guide: "M12 5v15 M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z",
  run: "m9 5 9 7-9 7V5Z",
  profile: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2",
  themes: "M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4 2 2 0 0 1 1-4h3a3 3 0 0 0 3-3c0-4-4-7-9-7Z M7 9h.01 M10 6h.01 M15 6h.01 M18 9h.01",
  reset: "M3 10a9 9 0 1 1 1 7 M3 4v6h6",
  signOut: "M9 3H4v18h5 M9 12h12 m-4-4 4 4-4 4",
  signIn: "M15 3h5v18h-5 M3 12h12 m-4-4 4 4-4 4",
  invites: "M3 5h18v14H3z m0 0 9 7 9-7",
  menu: "M3 6h18 M3 12h18 M3 18h18",
  collapse: "M4 3h16v18H4z M9 3v18 m7-12-3 3 3 3",
  expand: "M4 3h16v18H4z M9 3v18 m4-12 3 3-3 3",
  close: "m6 6 12 12 M6 18 18 6",
} as const;

export type SidebarIconName = keyof typeof paths;
export type SidebarAction = () => void | boolean | Promise<void | boolean>;

export function SidebarIcon({ name }: { name: SidebarIconName }) {
  return (
    <svg
      className="sidebarIcon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function SidebarItem({
  label,
  icon,
  current,
  primary,
  disabled,
  onClick,
}: {
  label: string;
  icon: SidebarIconName;
  current?: boolean;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className="sidebarItem"
      variant={primary ? "primary" : "quiet"}
      aria-label={label}
      title={label}
      aria-current={current ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <SidebarIcon name={icon} />
      <span className="sidebarLabel">{label}</span>
    </Button>
  );
}
