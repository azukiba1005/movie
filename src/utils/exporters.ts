import {
  AspectRatioType,
  BgmClip,
  MediaAsset,
  SubtitleItem,
  VideoClip,
} from '../types/editor';
import { getCanvasDimensions } from './canvasRenderer';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert seconds to FCPXML rational time string at 30fps (e.g., "3000/3000s" or frame-accurate "100/3000s" multiples)
 */
function toFcpxmlTime(seconds: number): string {
  const ticks = Math.max(0, Math.round(seconds * 30)) * 100;
  return `${ticks}/3000s`;
}

/**
 * Format seconds to SRT timestamp `HH:MM:SS,mmm`
 */
function toSrtTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const totalMs = Math.round(safe * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

/**
 * Generate standard SRT (.srt) subtitle content
 */
export function generateSrtString(subtitles: SubtitleItem[]): string {
  const sorted = [...subtitles].sort((a, b) => a.startTime - b.startTime);
  return sorted
    .map((sub, index) => {
      const start = toSrtTimestamp(sub.startTime);
      const end = toSrtTimestamp(Math.max(sub.startTime + 0.1, sub.endTime));
      return `${index + 1}\n${start} --> ${end}\n${sub.text.trim()}\n`;
    })
    .join('\n');
}

/**
 * Download SRT file
 */
export function downloadSrtFile(
  projectName: string,
  subtitles: SubtitleItem[]
): void {
  const content = generateSrtString(subtitles);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const safeName =
    projectName.replace(/[^a-zA-Z0-9._-\u3000-\u9fff]/g, '_') || 'subtitles';

  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.srt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/**
 * Generate FCPXML v1.9 (.fcpxml) for DaVinci Resolve / Final Cut Pro import.
 * Reflects all cuts, speed changes (timeMap), volume adjustments, BGM placement, and subtitles.
 */
export function generateFcpxmlString(params: {
  projectName: string;
  aspectRatio: AspectRatioType;
  mediaAssets: MediaAsset[];
  videoClips: VideoClip[];
  subtitles: SubtitleItem[];
  bgmClips: BgmClip[];
}): string {
  const {
    projectName,
    aspectRatio,
    mediaAssets,
    videoClips,
    subtitles,
    bgmClips,
  } = params;

  const { width, height } = getCanvasDimensions(aspectRatio);

  // Map mediaId to FCPXML resource id (r2, r3, ...)
  const assetIdMap = new Map<string, string>();
  mediaAssets.forEach((asset, idx) => {
    assetIdMap.set(asset.id, `r${idx + 2}`);
  });

  const totalDurSec = Math.max(
    videoClips.reduce((acc, c) => Math.max(acc, c.startTime + c.duration), 0),
    subtitles.reduce((acc, s) => Math.max(acc, s.endTime), 0),
    bgmClips.reduce((acc, b) => Math.max(acc, b.startTime + b.duration), 0),
    1
  );

  const resourceXml = mediaAssets
    .map((asset) => {
      const rId = assetIdMap.get(asset.id) || 'r2';
      const hasVideo = asset.type === 'video' ? '1' : '0';
      const srcPath = `file://localhost/${encodeURIComponent(asset.name)}`;
      return `    <asset id="${rId}" name="${escapeXml(
        asset.name
      )}" start="0s" duration="${toFcpxmlTime(
        asset.duration
      )}" hasVideo="${hasVideo}" hasAudio="1" format="r1" audioSources="1" audioChannels="2" audioRate="48000">
      <media-rep kind="original-media" src="${srcPath}"/>
    </asset>`;
    })
    .join('\n');

  const spineClipsXml = videoClips
    .map((clip, idx) => {
      const rId = assetIdMap.get(clip.mediaId) || 'r2';
      const offsetStr = toFcpxmlTime(clip.startTime);
      const durationStr = toFcpxmlTime(clip.duration);
      const startStr = toFcpxmlTime(clip.sourceStart);
      const volDb =
        clip.muted || clip.volume <= 0.001
          ? '-96dB'
          : `${(20 * Math.log10(clip.volume)).toFixed(1)}dB`;

      // Speed retime timeMap if clip.speed !== 1.0
      const timeMapXml =
        Math.abs(clip.speed - 1.0) > 0.01
          ? `\n            <timeMap>
              <timept time="0s" value="${toFcpxmlTime(clip.sourceStart)}" interp="linear"/>
              <timept time="${durationStr}" value="${toFcpxmlTime(
              clip.sourceEnd
            )}" interp="linear"/>
            </timeMap>`
          : '';

      // Attach BGM and Subtitles to the first clip or primary spine
      const attachedElements: string[] = [];

      if (idx === 0) {
        // Attach BGM clips on lane -1
        for (const bgm of bgmClips) {
          const bgmRId = assetIdMap.get(bgm.mediaId);
          if (!bgmRId) continue;
          const bgmVolDb =
            bgm.muted || bgm.volume <= 0.001
              ? '-96dB'
              : `${(20 * Math.log10(bgm.volume)).toFixed(1)}dB`;
          attachedElements.push(
            `            <asset-clip name="${escapeXml(
              bgm.name
            )}" lane="-1" offset="${toFcpxmlTime(
              clip.sourceStart + bgm.startTime
            )}" ref="${bgmRId}" start="${toFcpxmlTime(
              bgm.sourceStart
            )}" duration="${toFcpxmlTime(bgm.duration)}" audioRole="music">
              <adjust-volume amount="${bgmVolDb}"/>
            </asset-clip>`
          );
        }

        // Attach Subtitles on lane 1 as Basic Title elements
        subtitles.forEach((sub, sIdx) => {
          const subDur = Math.max(0.2, sub.endTime - sub.startTime);
          attachedElements.push(
            `            <title name="Subtitle ${
              sIdx + 1
            }" lane="1" offset="${toFcpxmlTime(
              clip.sourceStart + sub.startTime
            )}" ref="r_title" duration="${toFcpxmlTime(subDur)}" start="0s">
              <text>
                <text-style ref="ts${sIdx + 1}">${escapeXml(
              sub.text
            )}</text-style>
              </text>
              <text-style-def id="ts${sIdx + 1}">
                <text-style font="${escapeXml(
                  sub.style.fontFamily.replace(/"/g, '')
                )}" fontSize="${sub.style.fontSize}" fontColor="1 1 1 1" bold="1" alignment="${
              sub.style.align
            }"/>
              </text-style-def>
            </title>`
          );
        });
      }

      return `          <asset-clip name="${escapeXml(
        clip.name
      )}" offset="${offsetStr}" ref="${rId}" start="${startStr}" duration="${durationStr}" format="r1" tcFormat="NDF">
            <adjust-volume amount="${volDb}"/>${timeMapXml}${
        attachedElements.length > 0 ? '\n' + attachedElements.join('\n') : ''
      }
          </asset-clip>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat${height}p30" frameDuration="100/3000s" width="${width}" height="${height}" colorSpace="1-1-1 (Rec. 709)"/>
    <effect id="r_title" name="Basic Title" uid=".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti"/>
${resourceXml}
  </resources>
  <library>
    <event name="${escapeXml(projectName)}">
      <project name="${escapeXml(projectName)}">
        <sequence format="r1" duration="${toFcpxmlTime(
          totalDurSec
        )}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spineClipsXml}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
}

/**
 * Download FCPXML (.fcpxml) file for DaVinci Resolve
 */
export function downloadFcpxmlFile(params: {
  projectName: string;
  aspectRatio: AspectRatioType;
  mediaAssets: MediaAsset[];
  videoClips: VideoClip[];
  subtitles: SubtitleItem[];
  bgmClips: BgmClip[];
}): void {
  const xml = generateFcpxmlString(params);
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const safeName =
    params.projectName.replace(/[^a-zA-Z0-9._-\u3000-\u9fff]/g, '_') ||
    'timeline';

  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.fcpxml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

