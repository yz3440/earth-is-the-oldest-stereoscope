// Small hover tooltip used on control labels in the desktop horizontal
// controls bar. Styled to match the ProgressTicks hover pattern.

import { useState } from 'preact/hooks';

export function TooltipLabel({
  text,
  tooltip,
  className,
  style,
}: {
  text: string;
  tooltip: string;
  className?: string;
  style?: Record<string, string | number>;
}) {
  const [hover, setHover] = useState(false);

  return (
    <span
      class={className ?? 'text-[10px] opacity-60 tracking-wider'}
      style={{ position: 'relative', cursor: 'help', ...style }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {text}
      {hover && (
        <span
          class="pointer-events-none"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translate(-50%, -6px)',
            background: 'rgba(0,0,0,0.92)',
            border: '1px solid var(--line)',
            padding: '5px 8px',
            fontSize: 10,
            letterSpacing: '0.04em',
            color: 'var(--text)',
            whiteSpace: 'normal',
            width: 220,
            textAlign: 'left',
            opacity: 1,
            lineHeight: 1.35,
            zIndex: 60,
            textTransform: 'none',
          }}
        >
          {tooltip}
        </span>
      )}
    </span>
  );
}
