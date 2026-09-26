// Category and section symbols, drawn to the same spec as the rest of the
// site's icons: a 24x24 grid, 1.8px strokes, round caps, currentColor. They
// replace emoji, which are rendered by the viewer's device rather than by us
// - the same book turns up as a different picture on every platform - and
// which can't take the brand colours.

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const PATHS: Record<string, React.ReactNode> = {
  textbooks: (
    <>
      <path d="M12 7c-1.6-1.6-4.2-2.2-7-2.2v12.4c2.8 0 5.4.6 7 2.2 1.6-1.6 4.2-2.2 7-2.2V4.8c-2.8 0-5.4.6-7 2.2z" />
      <path d="M12 7v12.4" />
    </>
  ),
  notes: (
    <>
      <path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="M9.5 13h6" />
      <path d="M9.5 17h4" />
    </>
  ),
  electronics: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 19.5h20" />
    </>
  ),
  clothes: (
    <>
      <path d="M8.5 3.5 5 5.5 3 9.5l3 1.6V20.5h12V11.1l3-1.6-2-4-3.5-2" />
      <path d="M8.5 3.5c0 1.9 1.6 3 3.5 3s3.5-1.1 3.5-3" />
    </>
  ),
  dorm: (
    <>
      <path d="M9 3.5h6l3.2 7H5.8z" />
      <path d="M12 10.5v8" />
      <path d="M8.5 20.5h7" />
    </>
  ),
  bikes: (
    <>
      <circle cx="5.8" cy="16.4" r="3.4" />
      <circle cx="18.2" cy="16.4" r="3.4" />
      <path d="m5.8 16.4 4-8.4h4.4l4 8.4" />
      <path d="M9.2 8h5" />
    </>
  ),
  sports: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="m12 7.6 3.9 2.8-1.5 4.6H9.6l-1.5-4.6z" />
      <path d="M12 3.4v4.2M19.6 9.5l-3.7 2.9M16.6 19l-2.2-4M7.4 19l2.2-4M4.4 9.5l3.7 2.9" />
    </>
  ),
  tickets: (
    <>
      <path d="M3.5 8.5a1.5 1.5 0 0 1 1.5-1.5h14a1.5 1.5 0 0 1 1.5 1.5v2a2 2 0 0 0 0 3v2a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-2a2 2 0 0 0 0-3z" />
      <path d="M14 7.5v1.6M14 11.2v1.6M14 14.9v1.6" />
    </>
  ),
  services: (
    <>
      <path d="m12 4.2 9.3 4.6L12 13.4 2.7 8.8z" />
      <path d="M6.6 11v4.6c0 1.5 2.4 2.7 5.4 2.7s5.4-1.2 5.4-2.7V11" />
    </>
  ),
  other: (
    <>
      <path d="m3.5 8 8.5-4 8.5 4v8.4l-8.5 4-8.5-4z" />
      <path d="m3.5 8 8.5 4 8.5-4" />
      <path d="M12 12v8.4" />
    </>
  ),
  free: (
    <>
      <path d="M4.5 12h15v7.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z" />
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v12.5" />
      <path d="M12 8S9.4 8 8.5 6.8 9.2 4.2 10.2 4.7 12 8 12 8m0 0s2.6 0 3.5-1.2-.7-2.6-1.7-2.1S12 8 12 8" />
    </>
  ),
  all: (
    <>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.4" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.4" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.4" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1.4" />
    </>
  ),
  // section headings
  popular: (
    <>
      <path d="M12 3.5c.9 3.6-1.8 4.6-1.8 7.2a1.8 1.8 0 0 0 3.6 0c0-.9.4-1.8.9-2.7 1.8 1.8 2.7 3.6 2.7 5.4a5.4 5.4 0 0 1-10.8 0c0-4.5 4.5-6.3 5.4-9.9z" />
    </>
  ),
  recent: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7v5.3l3.4 2" />
    </>
  ),
};

export default function CategoryIcon({ name, className }: IconProps & { name: string }) {
  const paths = PATHS[name] ?? PATHS.other;
  return (
    <svg {...base} className={className}>
      {paths}
    </svg>
  );
}
