export interface PopoverPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  openUp: boolean;
}

interface PopoverAnchorBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
}

interface PopoverViewportBounds {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function calculatePopoverPosition({
  anchor,
  viewport,
  layoutViewportHeight,
  align,
  matchAnchorWidth,
  minWidth,
}: {
  anchor: PopoverAnchorBounds;
  viewport: PopoverViewportBounds;
  layoutViewportHeight: number;
  align: "left" | "right";
  matchAnchorWidth: boolean;
  minWidth: number;
}): PopoverPosition {
  const gap = 6;
  const margin = 8;
  const viewportTop = viewport.top;
  const viewportBottom = viewport.top + Math.max(0, viewport.height);
  const viewportLeft = viewport.left;
  const viewportRight = viewport.left + Math.max(0, viewport.width);
  const visibleHeight = Math.max(0, viewport.height - margin * 2);
  const spaceBelow = Math.max(0, viewportBottom - margin - anchor.bottom - gap);
  const spaceAbove = Math.max(0, anchor.top - gap - viewportTop - margin);
  const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
  const maxHeight = Math.min(300, visibleHeight, openUp ? spaceAbove : spaceBelow);
  const availableWidth = Math.max(0, viewport.width - margin * 2);
  const desiredWidth = Math.max(
    anchor.width,
    matchAnchorWidth ? 0 : minWidth,
    minWidth,
  );
  const width = Math.min(320, availableWidth, desiredWidth);
  const desiredLeft = align === "right" ? anchor.right - width : anchor.left;
  const maxLeft = Math.max(viewportLeft + margin, viewportRight - width - margin);
  const left = Math.min(Math.max(viewportLeft + margin, desiredLeft), maxLeft);
  const verticalMin = viewportTop + margin;
  const verticalMax = Math.max(verticalMin, viewportBottom - margin);

  if (openUp) {
    const panelBottom = Math.min(Math.max(verticalMin, anchor.top - gap), verticalMax);
    return {
      bottom: layoutViewportHeight - panelBottom,
      left,
      width,
      maxHeight,
      openUp,
    };
  }

  return {
    top: Math.min(Math.max(verticalMin, anchor.bottom + gap), verticalMax),
    left,
    width,
    maxHeight,
    openUp,
  };
}
