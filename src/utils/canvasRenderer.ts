import {
  AspectRatioType,
  SubtitleItem,
  SubtitleStyle,
  VideoClip,
} from '../types/editor';

export function getCanvasDimensions(aspectRatio: AspectRatioType): {
  width: number;
  height: number;
} {
  return aspectRatio === '16:9'
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1920 };
}

/**
 * Convert hex color + alpha (0..1) into rgba() string
 */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

/**
 * Draw a single subtitle item with broadcast-grade double outline, background box (zabuton),
 * custom font, letter spacing, and drop shadow onto the canvas context.
 */
export function renderSubtitleOnCanvas(
  ctx: CanvasRenderingContext2D,
  subtitle: SubtitleItem,
  canvasWidth: number,
  canvasHeight: number
): void {
  const text = subtitle.text;
  if (!text || !text.trim()) return;

  const style: SubtitleStyle = subtitle.style;
  const lines = text.split(/\r?\n/);

  ctx.save();

  const fontSize = Math.max(12, style.fontSize);
  const fontSpec = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
  ctx.font = fontSpec;
  ctx.textBaseline = 'middle';

  // Apply letterSpacing if supported by browser canvas
  if ('letterSpacing' in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${style.letterSpacing || 0}px`;
  }

  const lineHeightPx = fontSize * (style.lineHeight || 1.3);
  const lineMetrics = lines.map((line) => ctx.measureText(line));
  const maxLineWidth = Math.max(...lineMetrics.map((m) => m.width), 10);
  const totalTextHeight = lineHeightPx * lines.length;

  const anchorX = (style.x / 100) * canvasWidth;
  const anchorY = (style.y / 100) * canvasHeight;

  // Compute bounding box center X based on text alignment
  let boxCenterX = anchorX;
  if (style.align === 'left') {
    boxCenterX = anchorX + maxLineWidth / 2;
  } else if (style.align === 'right') {
    boxCenterX = anchorX - maxLineWidth / 2;
  }

  const topY = anchorY - totalTextHeight / 2;

  // 1. Background Box (背景座布団)
  if (style.background.enabled) {
    ctx.save();
    const padX = style.background.paddingX;
    const padY = style.background.paddingY;
    const boxX = boxCenterX - maxLineWidth / 2 - padX;
    const boxY = topY - padY;
    const boxW = maxLineWidth + padX * 2;
    const boxH = totalTextHeight + padY * 2;
    const radius = Math.min(
      style.background.borderRadius,
      boxW / 2,
      boxH / 2
    );

    if (style.shadow.enabled) {
      ctx.shadowColor = style.shadow.color;
      ctx.shadowBlur = style.shadow.blur;
      ctx.shadowOffsetX = style.shadow.offsetX;
      ctx.shadowOffsetY = style.shadow.offsetY;
    }

    ctx.fillStyle = hexToRgba(
      style.background.color,
      style.background.opacity
    );
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(boxX, boxY, boxW, boxH, radius);
    } else {
      ctx.rect(boxX, boxY, boxW, boxH);
    }
    ctx.fill();
    ctx.restore();
  }

  ctx.textAlign = style.align;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.miterLimit = 2;

  const innerW = style.innerOutline.enabled
    ? Math.max(0, style.innerOutline.width)
    : 0;
  const outerW = style.outerOutline.enabled
    ? Math.max(0, style.outerOutline.width)
    : 0;

  lines.forEach((line, index) => {
    const lineY = topY + lineHeightPx * (index + 0.5);

    // 2. Outer Outline (外側縁取り) + Drop Shadow (if background box wasn't already casting shadow)
    if (outerW > 0) {
      ctx.save();
      if (style.shadow.enabled && !style.background.enabled) {
        ctx.shadowColor = style.shadow.color;
        ctx.shadowBlur = style.shadow.blur;
        ctx.shadowOffsetX = style.shadow.offsetX;
        ctx.shadowOffsetY = style.shadow.offsetY;
      }
      ctx.strokeStyle = style.outerOutline.color;
      // Total stroke width spans both inner and outer outline radii on both sides of glyph stroke
      ctx.lineWidth = (innerW + outerW) * 2;
      ctx.strokeText(line, anchorX, lineY);
      ctx.restore();
    }

    // 3. Inner Outline (内側縁取り)
    if (innerW > 0) {
      ctx.save();
      if (
        style.shadow.enabled &&
        !style.background.enabled &&
        outerW === 0
      ) {
        ctx.shadowColor = style.shadow.color;
        ctx.shadowBlur = style.shadow.blur;
        ctx.shadowOffsetX = style.shadow.offsetX;
        ctx.shadowOffsetY = style.shadow.offsetY;
      }
      ctx.strokeStyle = style.innerOutline.color;
      ctx.lineWidth = innerW * 2;
      ctx.strokeText(line, anchorX, lineY);
      ctx.restore();
    }

    // 4. Fill Text (文字本体)
    ctx.save();
    if (
      style.shadow.enabled &&
      !style.background.enabled &&
      outerW === 0 &&
      innerW === 0
    ) {
      ctx.shadowColor = style.shadow.color;
      ctx.shadowBlur = style.shadow.blur;
      ctx.shadowOffsetX = style.shadow.offsetX;
      ctx.shadowOffsetY = style.shadow.offsetY;
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, anchorX, lineY);
    ctx.restore();
  });

  ctx.restore();
}

/**
 * Draw safe zone guides for YouTube 16:9 or YouTube Shorts 9:16
 */
function renderSafeZoneGuides(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  aspectRatio: AspectRatioType
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(6, 182, 212, 0.45)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);

  // 90% Action Safe
  const actionMarginX = width * 0.05;
  const actionMarginY = height * 0.05;
  ctx.strokeRect(
    actionMarginX,
    actionMarginY,
    width - actionMarginX * 2,
    height - actionMarginY * 2
  );

  if (aspectRatio === '9:16') {
    // YouTube Shorts bottom UI & right action buttons danger zone
    ctx.fillStyle = 'rgba(244, 63, 94, 0.14)';
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.5)';
    // Bottom 22% (channel name, caption, music ticker)
    const bottomUiH = height * 0.22;
    ctx.fillRect(0, height - bottomUiH, width, bottomUiH);
    ctx.strokeRect(0, height - bottomUiH, width, bottomUiH);

    // Right side icons (like/dislike/comments/share)
    const rightUiW = width * 0.16;
    const rightUiH = height * 0.42;
    ctx.fillRect(
      width - rightUiW,
      height - bottomUiH - rightUiH,
      rightUiW,
      rightUiH
    );
  }

  ctx.restore();
}

/**
 * Render a complete composite frame (background + video clip + active subtitles + optional guides)
 */
export function renderCompositeFrame(params: {
  ctx: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  aspectRatio: AspectRatioType;
  timelineTime: number;
  activeClip: VideoClip | null;
  videoElement: HTMLVideoElement | null;
  subtitles: SubtitleItem[];
  showSafeZone?: boolean;
  missingVideoFile?: boolean;
}): void {
  const {
    ctx,
    canvasWidth,
    canvasHeight,
    aspectRatio,
    timelineTime,
    activeClip,
    videoElement,
    subtitles,
    showSafeZone = false,
    missingVideoFile = false,
  } = params;

  // 1. Clear & fill base studio black
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // 2. Render active video clip if available
  if (
    activeClip &&
    videoElement &&
    videoElement.readyState >= 2 &&
    videoElement.videoWidth > 0 &&
    !missingVideoFile
  ) {
    ctx.save();
    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;

    // Fit inside canvas while preserving aspect ratio
    const baseScale = Math.min(canvasWidth / vw, canvasHeight / vh);
    const finalScale = baseScale * (activeClip.scale || 1.0);

    const drawW = vw * finalScale;
    const drawH = vh * finalScale;

    const centerX = canvasWidth / 2 + (activeClip.positionX || 0);
    const centerY = canvasHeight / 2 + (activeClip.positionY || 0);

    ctx.drawImage(
      videoElement,
      centerX - drawW / 2,
      centerY - drawH / 2,
      drawW,
      drawH
    );
    ctx.restore();
  } else {
    // Slate / Standby pattern when no video is loaded or when at an empty timeline spot
    ctx.save();
    const grad = ctx.createRadialGradient(
      canvasWidth / 2,
      canvasHeight / 2,
      50,
      canvasWidth / 2,
      canvasHeight / 2,
      Math.max(canvasWidth, canvasHeight) * 0.65
    );
    grad.addColorStop(0, '#1f242d');
    grad.addColorStop(1, '#09090b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Subtle grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    const step = 120;
    for (let x = 0; x < canvasWidth; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }
    for (let y = 0; y < canvasHeight; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }

    if (missingVideoFile && activeClip) {
      ctx.fillStyle = '#f59e0b';
      ctx.font = '700 36px "Noto Sans JP", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        `元動画ファイルを再選択してください: ${activeClip.name}`,
        canvasWidth / 2,
        canvasHeight / 2
      );
    } else if (activeClip) {
      // Synthetic preview animation for demo / audio-only clips
      ctx.fillStyle = 'rgba(6, 182, 212, 0.12)';
      const pulseRadius = 140 + Math.sin(timelineTime * 4) * 25;
      ctx.beginPath();
      ctx.arc(canvasWidth / 2, canvasHeight / 2 - 40, pulseRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#a1a1aa';
      ctx.font = '600 30px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${activeClip.name}  [${activeClip.speed.toFixed(2)}x]`,
        canvasWidth / 2,
        canvasHeight / 2 - 40
      );
    }
    ctx.restore();
  }

  // 3. Render active subtitles at timelineTime
  const activeSubtitles = subtitles.filter(
    (s) => timelineTime >= s.startTime && timelineTime <= s.endTime
  );

  for (const sub of activeSubtitles) {
    renderSubtitleOnCanvas(ctx, sub, canvasWidth, canvasHeight);
  }

  // 4. Optional Safe Zone Overlay
  if (showSafeZone) {
    renderSafeZoneGuides(ctx, canvasWidth, canvasHeight, aspectRatio);
  }
}

