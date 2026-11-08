import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function baseProps(props: IconProps): IconProps {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.35,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    focusable: "false",
    ...props,
  };
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.2 4.2" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c.6-3.7 3.4-5.8 7-5.8s6.4 2.1 7 5.8" />
    </svg>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M12 20c-4.7-3.1-8-5.9-8-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 3.5c0 3.6-3.3 6.4-8 9.5Z" />
    </svg>
  );
}

export function BagIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M6 8.5h12l-.9 11H6.9L6 8.5Z" />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 2.6v2.1M12 19.3v2.1M4.3 4.3l1.5 1.5M18.2 18.2l1.5 1.5M2.6 12h2.1M19.3 12h2.1M4.3 19.7l1.5-1.5M18.2 5.8l1.5-1.5" />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M20 14.3A8.2 8.2 0 0 1 9.7 4a8.3 8.3 0 1 0 10.3 10.3Z" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M3.5 7h17M3.5 12h17M3.5 17h11" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="m6 9.5 6 6 6-6" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M4.5 12h15M14 6.5l5.5 5.5-5.5 5.5" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M19.5 12h-15M10 6.5 4.5 12l5.5 5.5" />
    </svg>
  );
}

export function TruckIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M3 7.5h10.5v9H3zM13.5 10.5H18l3 3v3h-7.5z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17.5" cy="18" r="1.6" />
    </svg>
  );
}

export function ReturnIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M4 9h9.5a5.5 5.5 0 0 1 0 11H8" />
      <path d="M8 5 4 9l4 4" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M12 3.5 19 6v5.7c0 4.2-2.8 7-7 8.8-4.2-1.8-7-4.6-7-8.8V6l7-2.5Z" />
      <path d="m9 12 2 2 4-4.2" />
    </svg>
  );
}

export function CardIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <rect x="3" y="5.5" width="18" height="13" rx="1.5" />
      <path d="M3 9.5h18M6.5 14.5h4" />
    </svg>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <svg {...baseProps({ ...props, fill: "currentColor", stroke: "none" })}>
      <path d="m12 3.6 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.6Z" />
    </svg>
  );
}
