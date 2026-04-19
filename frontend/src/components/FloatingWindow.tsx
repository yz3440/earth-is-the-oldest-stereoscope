// Grayscale floating window — draggable title bar + minimize toggle.
// Adapted from bullet-time's FloatingWindow (grayscale swap, subtle white
// glow instead of green). The body collapses to just the title bar when
// minimized so the viewer can still find and re-open it.

import { useRef, useCallback } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import type { ComponentChildren } from 'preact';

export interface FloatingWindowProps {
  title: string;
  width?: number;
  x?: number;
  y?: number;
  anchor?: 'left' | 'right';
  vAnchor?: 'top' | 'bottom';
  zIndex?: number;
  children: ComponentChildren;
  defaultMinimized?: boolean;
}

export function FloatingWindow({
  title,
  width,
  x = 14,
  y = 14,
  anchor = 'left',
  vAnchor = 'top',
  zIndex = 15,
  children,
  defaultMinimized = false,
}: FloatingWindowProps) {
  const minimized = useSignal(defaultMinimized);
  const winRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const positionedRef = useRef(false);

  const onPointerDown = useCallback((e: PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'BUTTON' || t.closest('button')) return;
    draggingRef.current = true;
    const bar = e.currentTarget as HTMLElement;
    bar.style.cursor = 'grabbing';
    bar.setPointerCapture(e.pointerId);
    const win = winRef.current;
    if (!win) return;
    const rect = win.getBoundingClientRect();
    offsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (!positionedRef.current) {
      win.style.top = `${rect.top}px`;
      win.style.left = `${rect.left}px`;
      win.style.right = '';
      win.style.bottom = '';
      positionedRef.current = true;
    }
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!draggingRef.current || !winRef.current) return;
    winRef.current.style.left = `${e.clientX - offsetRef.current.x}px`;
    winRef.current.style.top = `${e.clientY - offsetRef.current.y}px`;
  }, []);

  const onPointerUp = useCallback((e: PointerEvent) => {
    draggingRef.current = false;
    (e.currentTarget as HTMLElement).style.cursor = 'grab';
  }, []);

  const frame: Record<string, string | number> = {
    position: 'fixed',
    zIndex,
    background: 'rgba(0,0,0,0.85)',
    border: '1px solid rgba(255,255,255,0.22)',
    boxShadow: '0 0 12px rgba(255,255,255,0.05)',
    pointerEvents: 'auto',
  };
  if (width) frame.width = `${width}px`;
  if (anchor === 'right') frame.right = `${x}px`;
  else frame.left = `${x}px`;
  if (vAnchor === 'bottom') frame.bottom = `${y}px`;
  else frame.top = `${y}px`;

  return (
    <div ref={winRef} style={frame}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 10px',
          cursor: 'grab',
          borderBottom: minimized.value ? 'none' : '1px solid rgba(255,255,255,0.15)',
          userSelect: 'none',
          touchAction: 'none',
          gap: 12,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span style={{ fontSize: 11, letterSpacing: '0.18em', opacity: 0.9 }}>{title}</span>
        <button
          type="button"
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,0.35)',
            color: 'var(--text)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 12,
            lineHeight: 1,
            padding: '1px 6px',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => { minimized.value = !minimized.value; }}
          title={minimized.value ? 'Expand' : 'Minimize'}
        >
          {minimized.value ? '□' : '_'}
        </button>
      </div>
      {!minimized.value && <div style={{ overflow: 'hidden' }}>{children}</div>}
    </div>
  );
}
