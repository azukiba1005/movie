import {
  CutInterval,
  MediaAsset,
  SilenceConfig,
  VideoClip,
} from '../types/editor';

/**
 * Probe video/audio element duration & dimensions via DOM element
 */
export function probeMediaMetadata(
  objectUrl: string,
  type: 'video' | 'bgm'
): Promise<{ duration: number; width?: number; height?: number }> {
  return new Promise((resolve, reject) => {
    const el =
      type === 'video'
        ? document.createElement('video')
        : document.createElement('audio');
    el.preload = 'metadata';
    el.src = objectUrl;

    const cleanup = () => {
      el.onloadedmetadata = null;
      el.onerror = null;
    };

    el.onloadedmetadata = () => {
      const duration =
        Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10;
      const width =
        type === 'video' ? (el as HTMLVideoElement).videoWidth || 1920 : undefined;
      const height =
        type === 'video' ? (el as HTMLVideoElement).videoHeight || 1080 : undefined;
      cleanup();
      resolve({ duration, width, height });
    };

    el.onerror = () => {
      cleanup();
      reject(new Error('メディアのメタデータ読み込みに失敗しました'));
    };
  });
}

/**
 * Extract high-speed waveform peaks (normalized 0.0..1.0) using Web Audio API
 */
export async function extractWaveformPeaks(
  file: File | Blob,
  peaksPerSecond = 50
): Promise<{
  peaks: number[];
  duration: number;
  sampleRate: number;
  audioBuffer: AudioBuffer | null;
}> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;

  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioCtx();

  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const duration = audioBuffer.duration;
    const totalPeaks = Math.max(1, Math.ceil(duration * peaksPerSecond));
    const channelData = audioBuffer.getChannelData(0);
    const secondChannel =
      audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;

    const samplesPerPeak = Math.max(
      1,
      Math.floor(channelData.length / totalPeaks)
    );
    const peaks: number[] = new Array(totalPeaks);

    for (let i = 0; i < totalPeaks; i++) {
      const startIdx = i * samplesPerPeak;
      const endIdx = Math.min(channelData.length, startIdx + samplesPerPeak);
      let maxAbs = 0;
      // Step by 4 for fast scanning on long videos
      const step = Math.max(1, Math.floor((endIdx - startIdx) / 64));
      for (let j = startIdx; j < endIdx; j += step) {
        let sample = Math.abs(channelData[j]);
        if (secondChannel) {
          sample = Math.max(sample, Math.abs(secondChannel[j]));
        }
        if (sample > maxAbs) {
          maxAbs = sample;
        }
      }
      peaks[i] = Number(Math.min(1, maxAbs).toFixed(4));
    }

    await audioCtx.close();
    return {
      peaks,
      duration,
      sampleRate: peaksPerSecond,
      audioBuffer,
    };
  } catch {
    await audioCtx.close();
    return {
      peaks: [],
      duration: 0,
      sampleRate: peaksPerSecond,
      audioBuffer: null,
    };
  }
}

/**
 * Detect silent intervals across the active timeline VideoClips using Web Audio API waveform peaks.
 * Supports threshold (dB), minSilenceDuration (ms), and padding before/after speech (ms).
 */
export function detectSilenceOnTimeline(
  videoClips: VideoClip[],
  mediaAssets: MediaAsset[],
  config: SilenceConfig
): CutInterval[] {
  // Convert dB threshold (e.g. -36dB) to linear amplitude (0..1)
  const linearThreshold = Math.pow(10, config.thresholdDb / 20);
  const minSilenceSec = Math.max(0.08, config.minSilenceDurationMs / 1000);
  const paddingSec = Math.max(0, config.paddingMs / 1000);

  const detected: CutInterval[] = [];
  let counter = 0;

  for (const clip of videoClips) {
    const asset = mediaAssets.find((m) => m.id === clip.mediaId);
    if (!asset || !asset.waveformPeaks || asset.waveformPeaks.length === 0) {
      continue;
    }

    const peaks = asset.waveformPeaks;
    const rate = asset.waveformSampleRate || 50;
    const startPeakIdx = Math.max(0, Math.floor(clip.sourceStart * rate));
    const endPeakIdx = Math.min(
      peaks.length - 1,
      Math.ceil(clip.sourceEnd * rate)
    );

    let silentStartPeak: number | null = null;

    for (let i = startPeakIdx; i <= endPeakIdx; i++) {
      const amp = peaks[i] ?? 0;
      const isSilent = amp < linearThreshold;

      if (isSilent && silentStartPeak === null) {
        silentStartPeak = i;
      } else if (!isSilent && silentStartPeak !== null) {
        const srcSilenceStart = Math.max(
          clip.sourceStart,
          silentStartPeak / rate
        );
        const srcSilenceEnd = Math.min(clip.sourceEnd, i / rate);

        // Convert source interval to timeline interval (accounting for clip speed)
        const rawTimelineStart =
          clip.startTime +
          (srcSilenceStart - clip.sourceStart) / clip.speed;
        const rawTimelineEnd =
          clip.startTime + (srcSilenceEnd - clip.sourceStart) / clip.speed;

        const paddedStart = rawTimelineStart + paddingSec;
        const paddedEnd = rawTimelineEnd - paddingSec;

        if (paddedEnd - paddedStart >= minSilenceSec) {
          detected.push({
            id: `silence-${counter++}-${Math.round(paddedStart * 1000)}`,
            start: Number(paddedStart.toFixed(3)),
            end: Number(paddedEnd.toFixed(3)),
            type: 'silence',
            category: 'silence',
            reason: `無音区間 (${(paddedEnd - paddedStart).toFixed(2)}s / < ${
              config.thresholdDb
            }dB)`,
            selected: true,
          });
        }
        silentStartPeak = null;
      }
    }

    // Handle trailing silence at end of clip
    if (silentStartPeak !== null) {
      const srcSilenceStart = Math.max(
        clip.sourceStart,
        silentStartPeak / rate
      );
      const srcSilenceEnd = clip.sourceEnd;
      const rawTimelineStart =
        clip.startTime +
        (srcSilenceStart - clip.sourceStart) / clip.speed;
      const rawTimelineEnd =
        clip.startTime + (srcSilenceEnd - clip.sourceStart) / clip.speed;

      const paddedStart = rawTimelineStart + paddingSec;
      const paddedEnd = rawTimelineEnd - paddingSec;

      if (paddedEnd - paddedStart >= minSilenceSec) {
        detected.push({
          id: `silence-${counter++}-${Math.round(paddedStart * 1000)}`,
          start: Number(paddedStart.toFixed(3)),
          end: Number(paddedEnd.toFixed(3)),
          type: 'silence',
          category: 'silence',
          reason: `無音区間 (${(paddedEnd - paddedStart).toFixed(2)}s / < ${
            config.thresholdDb
          }dB)`,
          selected: true,
        });
      }
    }
  }

  return detected;
}

/**
 * Encode a mono AudioBuffer into a 16-bit PCM WAV Blob
 */
export function encodeMonoAudioBufferToWav(buffer: AudioBuffer): Blob {
  const numSamples = buffer.length;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2; // 16-bit PCM
  const dataByteLength = numSamples * bytesPerSample;
  const arrayBuffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, 1, true); // NumChannels = 1 (Mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // ByteRate
  view.setUint16(32, bytesPerSample, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(36, 'data');
  view.setUint32(40, dataByteLength, true);

  const channelData = buffer.getChannelData(0);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Split timeline audio into lightweight 16kHz mono WAV chunks (e.g. 30s per chunk)
 * using OfflineAudioContext so long videos can be sent to Cloudflare Workers AI Whisper
 * without exceeding memory or request payload limits.
 */
export async function renderTimelineAudioChunksForWhisper(
  videoClips: VideoClip[],
  mediaAssets: MediaAsset[],
  chunkDurationSec = 35,
  onProgress?: (msg: string) => void
): Promise<
  Array<{
    blob: Blob;
    offsetSeconds: number;
    durationSeconds: number;
  }>
> {
  const targetSampleRate = 16000;
  const totalTimelineDuration = videoClips.reduce(
    (acc, c) => Math.max(acc, c.startTime + c.duration),
    0
  );

  if (totalTimelineDuration <= 0.1) {
    throw new Error('タイムライン上に動画クリップがありません。');
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const decodeCtx = new AudioCtx();

  // Decode each referenced video asset once
  const decodedMap = new Map<string, AudioBuffer>();
  for (const clip of videoClips) {
    if (decodedMap.has(clip.mediaId)) continue;
    const asset = mediaAssets.find((m) => m.id === clip.mediaId);
    if (!asset?.file) continue;
    onProgress?.(`音声トラックを解析中: ${asset.name}...`);
    const buf = await asset.file.arrayBuffer();
    const audioBuf = await decodeCtx.decodeAudioData(buf.slice(0));
    decodedMap.set(clip.mediaId, audioBuf);
  }
  await decodeCtx.close();

  const chunks: Array<{
    blob: Blob;
    offsetSeconds: number;
    durationSeconds: number;
  }> = [];

  for (
    let chunkStart = 0;
    chunkStart < totalTimelineDuration;
    chunkStart += chunkDurationSec
  ) {
    const chunkEnd = Math.min(
      totalTimelineDuration,
      chunkStart + chunkDurationSec
    );
    const chunkLen = chunkEnd - chunkStart;
    if (chunkLen < 0.2) break;

    const frameCount = Math.ceil(chunkLen * targetSampleRate);
    const offlineCtx = new OfflineAudioContext(1, frameCount, targetSampleRate);

    // Schedule all clips overlapping [chunkStart, chunkEnd]
    for (const clip of videoClips) {
      const clipEnd = clip.startTime + clip.duration;
      if (clipEnd <= chunkStart || clip.startTime >= chunkEnd || clip.muted) {
        continue;
      }
      const audioBuf = decodedMap.get(clip.mediaId);
      if (!audioBuf) continue;

      const overlapStart = Math.max(chunkStart, clip.startTime);
      const overlapEnd = Math.min(chunkEnd, clipEnd);
      const overlapTimelineDur = overlapEnd - overlapStart;
      if (overlapTimelineDur <= 0.02) continue;

      const relClipOffset = overlapStart - clip.startTime;
      const srcOffset = clip.sourceStart + relClipOffset * clip.speed;
      const srcDuration = overlapTimelineDur * clip.speed;

      const sourceNode = offlineCtx.createBufferSource();
      sourceNode.buffer = audioBuf;
      sourceNode.playbackRate.value = clip.speed;

      const gainNode = offlineCtx.createGain();
      gainNode.gain.value = clip.volume;

      sourceNode.connect(gainNode);
      gainNode.connect(offlineCtx.destination);

      const whenInChunk = overlapStart - chunkStart;
      sourceNode.start(whenInChunk, srcOffset, srcDuration);
    }

    const renderedBuffer = await offlineCtx.startRendering();
    const wavBlob = encodeMonoAudioBufferToWav(renderedBuffer);

    chunks.push({
      blob: wavBlob,
      offsetSeconds: Number(chunkStart.toFixed(3)),
      durationSeconds: Number(chunkLen.toFixed(3)),
    });
  }

  return chunks;
}

