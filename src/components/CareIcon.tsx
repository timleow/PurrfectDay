import type { ReactNode } from "react";

export type IconName =
  | "bowl"
  | "bell"
  | "calendar"
  | "chart"
  | "check"
  | "chevron"
  | "drop"
  | "ear"
  | "edit"
  | "family"
  | "heart"
  | "medical"
  | "minus"
  | "more"
  | "moon"
  | "paw"
  | "play"
  | "poop"
  | "pee"
  | "removePerson"
  | "plus"
  | "settings"
  | "sparkle"
  | "sun"
  | "treat"
  | "undo"
  | "yarn";

export default function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></>,
    bowl: (
      <>
        <path d="M4 10h16c-.45 5.4-3.1 8-8 8s-7.55-2.6-8-8Z" />
        <path d="M7 7.5c1.4-1.5 2.7-1.5 4 0s2.6 1.5 4 0" />
      </>
    ),
    calendar: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="3" />
        <path d="M8 3v4M16 3v4M4 10h16" />
      </>
    ),
    chart: <><path d="M4 19V5M4 19h16" /><path d="m7 15 4-4 3 2 5-6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    drop: <path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11Z" />,
    ear: (
      <>
        <path d="M6.2 5.7C8.3 2.2 14.8 2.1 17 6c2.1 3.8-.9 6.1-3 7.4-2.5 1.6-1.6 5.3-5.1 5.3-3.4 0-5.3-7.8-2.7-13Z" />
        <path d="M9 8.3c1.5-1.5 4.5-1.4 5.4.6.8 1.7-1.2 2.5-2.3 3.2" />
      </>
    ),
    edit: <><path d="m14.5 5.5 4 4M4 20l4.2-.9L19 7.3 16.7 5 5.9 15.8 4 20Z" /><path d="M13.8 6.2 17.8 10.2" /></>,
    family: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20v-1.4a5.5 5.5 0 0 1 11 0V20M16 5.5a3 3 0 0 1 0 5.8M17 14.2a4.7 4.7 0 0 1 3.5 4.5V20" />
      </>
    ),
    heart: <path d="M20.8 5.8c-2.4-2.4-6.3-1.8-8.8 1.1-2.5-2.9-6.4-3.5-8.8-1.1-2.7 2.7-1.4 7.3.9 9.6 2 2 7.9 5.6 7.9 5.6s5.9-3.6 7.9-5.6c2.3-2.3 3.6-6.9.9-9.6Z" />,
    medical: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="3" />
        <path d="M9 3v4h6V3M9 13h6M12 10v6" />
      </>
    ),
    minus: <path d="M6 12h12" />,
    more: <>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </>,
    moon: <path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z" />,
    poop: (
      <>
        <path d="M5 18.2c0-1.7 1.2-3 3-3.2-.7-2.1.4-4.3 2.6-4.8.3-2.4 1.5-4 3.4-4s3.1 1.6 3.4 4c2.1.5 3.2 2.7 2.5 4.8 1.8.2 3 1.5 3 3.2 0 1-.8 1.8-1.8 1.8H6.8c-1 0-1.8-.8-1.8-1.8Z" />
        <path d="M9.4 17.2h.1m5 0h.1m-3.6 1.2c.7.6 1.4.6 2.1 0" />
      </>
    ),
    pee: (
      <>
        <path d="M12 2.5s3.3 3.8 3.3 6.2a3.3 3.3 0 0 1-6.6 0c0-2.4 3.3-6.2 3.3-6.2Z" />
        <path d="M5.3 12.8s2.3 2.7 2.3 4.4a2.3 2.3 0 0 1-4.6 0c0-1.7 2.3-4.4 2.3-4.4ZM18.7 12.8s2.3 2.7 2.3 4.4a2.3 2.3 0 0 1-4.6 0c0-1.7 2.3-4.4 2.3-4.4Z" />
      </>
    ),
    removePerson: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20v-1.4a5.5 5.5 0 0 1 11 0V20M17 10h5" /></>,
    paw: (
      <>
        <ellipse cx="12" cy="15.5" rx="5.3" ry="4.2" />
        <ellipse cx="5.7" cy="11" rx="2.1" ry="2.7" />
        <ellipse cx="18.3" cy="11" rx="2.1" ry="2.7" />
        <ellipse cx="9" cy="6.5" rx="2.1" ry="2.7" />
        <ellipse cx="15" cy="6.5" rx="2.1" ry="2.7" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7V5Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    settings: (
      <>
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
      </>
    ),
    sparkle: (
      <>
        <path d="M12 3c.7 4.8 3.2 7.3 8 8-4.8.7-7.3 3.2-8 8-.7-4.8-3.2-7.3-8-8 4.8-.7 7.3-3.2 8-8Z" />
        <path d="M19 2v4M17 4h4" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
    treat: (
      <>
        <path d="m7 8-3-2v6l3-2M17 8l3-2v6l-3-2" />
        <rect x="7" y="6" width="10" height="8" rx="3" />
      </>
    ),
    undo: <path d="M9 14 4 9l5-5M4 9h9a7 7 0 0 1 0 14h-2" />,
    yarn: (
      <>
        <circle cx="10.5" cy="12.5" r="6.5" />
        <path d="M5 9.2c2.1 1.5 5.8 1.7 10.8-.1M4.1 12.3c3.7-1.9 8.7-1.8 12.7.2M4.7 15.1c3.4-1.9 7.4-1.7 10.5.1M8.6 6.4c-.3 4.1 1.1 7.5 4.6 11.4M15.7 17.5c2.3-.2 3.7.2 4.4 1.3.7 1-.3 2.5-1.5 2" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}
