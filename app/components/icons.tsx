import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...rest,
  };
}

export function IconShield(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 5 6v5.5c0 4.3 2.9 7.9 7 9.5 4.1-1.6 7-5.2 7-9.5V6l-7-3Z" />
      <path d="m9.2 12.2 2 2 3.6-3.8" />
    </svg>
  );
}

export function IconActivity(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 12h4l2.5-7 4 14 2.5-7H21" />
    </svg>
  );
}

export function IconWallet(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a2 2 0 0 1 2 2v1" />
      <rect x="4" y="7.5" width="16" height="11.5" rx="2.5" />
      <path d="M16.5 13.2h.01" />
    </svg>
  );
}

export function IconList(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

export function IconBan(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6.5 17.5 11-11" />
    </svg>
  );
}

export function IconCompare(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4v16" />
      <path d="M7 8 4 11l3 3" />
      <path d="m17 8 3 3-3 3" />
    </svg>
  );
}

export function IconCode(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m8.5 8.5-4 3.5 4 3.5" />
      <path d="m15.5 8.5 4 3.5-4 3.5" />
    </svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function IconExternal(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 5h5v5" />
      <path d="M19 5 11 13" />
      <path d="M18 14.5V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5" />
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4.5 21 19H3l9-14.5Z" />
      <path d="M12 10v3.5" />
      <path d="M12 16.5h.01" />
    </svg>
  );
}

export function IconFlag(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 21V4" />
      <path d="M5 5h12l-2.5 3.5L17 12H5" />
    </svg>
  );
}

export function IconScale(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4v16" />
      <path d="M6 8h12" />
      <path d="M6 8 3.5 13.5a3 3 0 0 0 5 0L6 8Z" />
      <path d="m18 8-2.5 5.5a3 3 0 0 0 5 0L18 8Z" />
      <path d="M8 20h8" />
    </svg>
  );
}
