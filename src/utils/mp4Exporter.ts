import { Muxer, StreamTarget } from 'mp4-muxer';
import {
  AspectRatioType,
  BgmClip,
  MediaAsset,
  SubtitleItem,
  VideoClip,
} from '../types/editor';
import {
  getCanvasDimensions,
  renderCompositeFrame,
} from './canvasRenderer';

export interface Mp4ExportOptions {
  projectName: string;
  aspectRatio: AspectRatioType;
  fps?: number;
  videoBitrate?: number;
  mediaAssets: MediaAsset[];
  videoClips: VideoClip[];
  subtitles: SubtitleItem[];
  bgmClips: BgmClip[];
  /** Multicam: Cam 2 media id + offset (cam2 time = cam1 source time + cam2Offset) */
  cam2MediaId?: string | null;
  cam2Offset?: number;
  onProgress?: (percent: number, stageText: string) => void;
  signal?: AbortSignal;
}

/**
 * Helper to seek an HTMLVideoElement to a specific timestamp and wait until frame is decoded
 */
function seekVideoElement(
  video: HTMLVideoElement,
  timeSeconds: number
): Promise<void> {
  return new Promise((resolve) => {
    const clamped = Math.max(
      0,
      Math.min(
        Number.isFinite(video.duration) ? video.duration - 0.001 : timeSeconds,
        timeSeconds
      )
    );
    if (Math.abs(video.currentTime - clamped) < 0.008 && video.readyState >= 2) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', finish);
      resolve();
    };

    const timer = setTimeout(finish, 250);
    video.addEventListener(
      'seeked',
      () => {
        clearTimeout(timer);
        finish();
      },
      { once: true }
    );

    try {
      video.currentTime = clamped;
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

/**
 * Video frame feeder: picks Cam 1 / Cam 2 element per clip.cameraAngle and seeks it.
 * Audio never comes from here (Cam 1 is the master audio).
 */
function createVideoFeeder(options: {
  mediaAssets: MediaAsset[];
  cam2MediaId?: string | null;
  cam2Offset?: number;
}) {
  const { mediaAssets, cam2MediaId, cam2Offset = 0 } = options;
  const makeEl = () => {
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    return el;
  };
  const cam1El = makeEl();
  const cam2El = makeEl();
  const loaded = new Map<HTMLVideoElement, string>();

  const ensureLoaded = async (el: HTMLVideoElement, url: string) => {
    if (loaded.get(el) === url) return;
    loaded.set(el, url);
    el.src = url;
    await new Promise<void>((resolve) => {
      el.onloadeddata = () => resolve();
      el.onerror = () => resolve();
      el.load();
    });
  };

  return async (
    clip: VideoClip | null,
    timelineTime: number
  ): Promise<{ videoElement: HTMLVideoElement; missingVideoFile: boolean }> => {
    if (!clip) return { videoElement: cam1El, missingVideoFile: false };
    const srcTime =
      clip.sourceStart + (timelineTime - clip.startTime) * clip.speed;

    if (clip.cameraAngle === 2 && cam2MediaId) {
      const asset2 = mediaAssets.find((m) => m.id === cam2MediaId);
      const t2 = srcTime + cam2Offset;
      if (
        asset2 &&
        asset2.objectUrl &&
        !asset2.missingFile &&
        t2 >= 0 &&
        t2 < asset2.duration
      ) {
        await ensureLoaded(cam2El, asset2.objectUrl);
        await seekVideoElement(cam2El, t2);
        return { videoElement: cam2El, missingVideoFile: false };
      }
      // Cam 2 unavailable at this time -> fall back to Cam 1
    }

    const asset = mediaAssets.find((m) => m.id === clip.mediaId);
    if (asset && asset.objectUrl && !asset.missingFile) {
      await ensureLoaded(cam1El, asset.objectUrl);
      await seekVideoElement(cam1El, srcTime);
      return { videoElement: cam1El, missingVideoFile: false };
    }
    return { videoElement: cam1El, missingVideoFile: true };
  };
}

/**
 * Render mixed timeline audio (Track 2 VideoClips with speed/volume + Track 3 BGM with fadeIn/fadeOut)
 * for a given time window [windowStart, windowEnd] using OfflineAudioContext.
 */
async function renderAudioWindow(params: {
  windowStart: number;
  windowEnd: number;
  sampleRate: number;
  videoClips: VideoClip[];
  bgmClips: BgmClip[];
  decodedAudioMap: Map<string, AudioBuffer>;
}): Promise<AudioBuffer> {
  const {
    windowStart,
    windowEnd,
    sampleRate,
    videoClips,
    bgmClips,
    decodedAudioMap,
  } = params;

  const duration = Math.max(0.05, windowEnd - windowStart);
  const frameCount = Math.ceil(duration * sampleRate);
  const offlineCtx = new OfflineAudioContext(2, frameCount, sampleRate);

  // 1. Schedule Track 2 Video Clips audio
  for (const clip of videoClips) {
    if (clip.muted || clip.volume <= 0.001) continue;
    const clipEnd = clip.startTime + clip.duration;
    if (clipEnd <= windowStart || clip.startTime >= windowEnd) continue;

    const audioBuf = decodedAudioMap.get(clip.mediaId);
    if (!audioBuf) continue;

    const overlapStart = Math.max(windowStart, clip.startTime);
    const overlapEnd = Math.min(windowEnd, clipEnd);
    const overlapDur = overlapEnd - overlapStart;
    if (overlapDur <= 0.01) continue;

    const relStart = overlapStart - clip.startTime;
    const srcOffset = clip.sourceStart + relStart * clip.speed;
    const srcDur = overlapDur * clip.speed;

    const srcNode = offlineCtx.createBufferSource();
    srcNode.buffer = audioBuf;
    srcNode.playbackRate.value = clip.speed;

    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = clip.volume;

    srcNode.connect(gainNode);
    gainNode.connect(offlineCtx.destination);

    srcNode.start(overlapStart - windowStart, srcOffset, srcDur);
  }

  // 2. Schedule Track 3 BGM Clips with Fade-in / Fade-out envelope
  for (const bgm of bgmClips) {
    if (bgm.muted || bgm.volume <= 0.001) continue;
    const bgmEnd = bgm.startTime + bgm.duration;
    if (bgmEnd <= windowStart || bgm.startTime >= windowEnd) continue;

    const audioBuf = decodedAudioMap.get(bgm.mediaId);
    if (!audioBuf) continue;

    const overlapStart = Math.max(windowStart, bgm.startTime);
    const overlapEnd = Math.min(windowEnd, bgmEnd);
    const overlapDur = overlapEnd - overlapStart;
    if (overlapDur <= 0.01) continue;

    const relStart = overlapStart - bgm.startTime;
    const srcOffset = bgm.sourceStart + relStart;

    const srcNode = offlineCtx.createBufferSource();
    srcNode.buffer = audioBuf;

    const gainNode = offlineCtx.createGain();
    const startInWindow = overlapStart - windowStart;

    const computeGainAtRel = (relSec: number) => {
      let g = bgm.volume;
      if (bgm.fadeIn > 0 && relSec < bgm.fadeIn) {
        g *= Math.max(0, relSec / bgm.fadeIn);
      }
      const rem = bgm.duration - relSec;
      if (bgm.fadeOut > 0 && rem < bgm.fadeOut) {
        g *= Math.max(0, rem / bgm.fadeOut);
      }
      return g;
    };

    // Schedule envelope breakpoints (fade boundaries) so fades are not smeared across the window
    const relEnd = relStart + overlapDur;
    const breakpoints = [relStart];
    const candidates = [bgm.fadeIn, bgm.duration - bgm.fadeOut];
    for (const bp of candidates) {
      if (bgm.fadeIn >= 0 && bp > relStart && bp < relEnd) breakpoints.push(bp);
    }
    breakpoints.push(relEnd);
    breakpoints.sort((a, b) => a - b);

    gainNode.gain.setValueAtTime(
      computeGainAtRel(breakpoints[0]),
      startInWindow
    );
    for (let bi = 1; bi < breakpoints.length; bi++) {
      gainNode.gain.linearRampToValueAtTime(
        computeGainAtRel(breakpoints[bi]),
        startInWindow + (breakpoints[bi] - relStart)
      );
    }

    srcNode.connect(gainNode);
    gainNode.connect(offlineCtx.destination);
    srcNode.start(startInWindow, srcOffset, overlapDur);
  }

  return offlineCtx.startRendering();
}

/**
 * Find the best supported H.264 codec string for the target resolution (1920x1080 or 1080x1920)
 */
async function resolveSupportedH264Codec(
  width: number,
  height: number,
  bitrate: number,
  fps: number
): Promise<string | null> {
  if (typeof VideoEncoder === 'undefined') return null;

  const candidates = [
    'avc1.640032', // High Profile Level 5.0 (supports both 1920x1080 and 1080x1920)
    'avc1.64002a', // High Profile Level 4.2
    'avc1.640028', // High Profile Level 4.0
    'avc1.4d0032', // Main Profile Level 5.0
    'avc1.4d002a', // Main Profile Level 4.2
    'avc1.420028', // Baseline Profile Level 4.0
  ];

  for (const codec of candidates) {
    try {
      const res = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
      });
      if (res.supported) {
        return codec;
      }
    } catch {
      // Try next profile
    }
  }
  return null;
}

/**
 * Fallback exporter using Canvas.captureStream + WebAudio MediaStreamDestination + MediaRecorder
 * if WebCodecs API is unavailable on the current browser.
 */
async function exportViaMediaRecorderFallback(
  options: Mp4ExportOptions,
  decodedAudioMap: Map<string, AudioBuffer>,
  totalDuration: number
): Promise<void> {
  const {
    projectName,
    aspectRatio,
    fps = 30,
    videoBitrate = 8_000_000,
    mediaAssets,
    videoClips,
    subtitles,
    bgmClips,
    onProgress,
    signal,
  } = options;

  const { width, height } = getCanvasDimensions(aspectRatio);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D コンテキストを作成できませんでした');

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const audioCtx = new AudioCtx();
  const destNode = audioCtx.createMediaStreamDestination();

  // Render full mixed audio buffer and play into MediaStreamDestination
  const mixedAudio = await renderAudioWindow({
    windowStart: 0,
    windowEnd: totalDuration,
    sampleRate: 48000,
    videoClips,
    bgmClips,
    decodedAudioMap,
  });

  const audioSource = audioCtx.createBufferSource();
  audioSource.buffer = mixedAudio;
  audioSource.connect(destNode);

  const canvasStream = canvas.captureStream(fps);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destNode.stream.getAudioTracks(),
  ]);

  const mimeCandidates = [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ];
  const chosenMime =
    mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(combinedStream, {
    mimeType: chosenMime || undefined,
    videoBitsPerSecond: videoBitrate,
  });

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  const feedVideo = createVideoFeeder({
    mediaAssets,
    cam2MediaId: options.cam2MediaId,
    cam2Offset: options.cam2Offset,
  });

  recorder.start(200);
  audioSource.start(0);

  const totalFrames = Math.max(1, Math.ceil(totalDuration * fps));
  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    if (signal?.aborted) {
      recorder.stop();
      await audioCtx.close();
      throw new Error('書き出しがキャンセルされました');
    }

    const timelineTime = frameIdx / fps;
    const activeClip =
      videoClips.find(
        (c) =>
          timelineTime >= c.startTime &&
          timelineTime < c.startTime + c.duration
      ) || null;

    const fed = await feedVideo(activeClip, timelineTime);
    const missingVideoFile = activeClip ? fed.missingVideoFile : false;
    const videoEl = fed.videoElement;

    renderCompositeFrame({
      ctx,
      canvasWidth: width,
      canvasHeight: height,
      aspectRatio,
      timelineTime,
      activeClip,
      videoElement: videoEl,
      subtitles,
      showSafeZone: false,
      missingVideoFile,
    });

    const pct = 10 + Math.round(((frameIdx + 1) / totalFrames) * 85);
    onProgress?.(
      pct,
      `ストリーム録画エンコード中: ${frameIdx + 1} / ${totalFrames} フレーム`
    );
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }

  await new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
    recorder.stop();
  });
  await audioCtx.close();

  const outBlob = new Blob(chunks, {
    type: chosenMime || 'video/mp4',
  });
  const url = URL.createObjectURL(outBlob);
  const safeName =
    projectName.replace(/[^a-zA-Z0-9._-\u3000-\u9fff]/g, '_') || 'output';
  const ext = chosenMime.includes('webm') ? 'webm' : 'mp4';

  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 8000);

  onProgress?.(100, '動画の書き出しが完了しました！');
}

/**
 * Export the timeline to an MP4 file using WebCodecs API + `mp4-muxer` (StreamTarget)
 * so long-form videos are encoded in memory-safe chunks, with automatic fallback to MediaRecorder.
 */
export async function exportTimelineToMp4(
  options: Mp4ExportOptions
): Promise<void> {
  const {
    projectName,
    aspectRatio,
    fps = 30,
    videoBitrate = 8_000_000,
    mediaAssets,
    videoClips,
    subtitles,
    bgmClips,
    onProgress,
    signal,
  } = options;

  const { width, height } = getCanvasDimensions(aspectRatio);

  const totalDuration = Math.max(
    videoClips.reduce((acc, c) => Math.max(acc, c.startTime + c.duration), 0),
    subtitles.reduce((acc, s) => Math.max(acc, s.endTime), 0),
    1
  );

  onProgress?.(2, '音声トラックをデコードしています...');

  // Decode audio buffers for referenced assets
  const decodedAudioMap = new Map<string, AudioBuffer>();
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const decodeCtx = new AudioCtx();

  for (const asset of mediaAssets) {
    if (!asset.file || asset.id === options.cam2MediaId) continue; // Cam 2 audio is never used
    try {
      const ab = await asset.file.arrayBuffer();
      const decoded = await decodeCtx.decodeAudioData(ab.slice(0));
      decodedAudioMap.set(asset.id, decoded);
    } catch {
      // Asset might be video-only without audio stream
    }
  }
  await decodeCtx.close();

  const supportedH264Codec = await resolveSupportedH264Codec(
    width,
    height,
    videoBitrate,
    fps
  );

  if (!supportedH264Codec || !('VideoFrame' in window)) {
    // Fallback to MediaRecorder stream capture
    await exportViaMediaRecorderFallback(
      options,
      decodedAudioMap,
      totalDuration
    );
    return;
  }

  // Check if AudioEncoder is supported for AAC
  let useAudioEncoder = 'AudioEncoder' in window && 'AudioData' in window;
  const audioSampleRate = 48000;
  if (useAudioEncoder) {
    try {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: audioSampleRate,
        numberOfChannels: 2,
        bitrate: 192_000,
      });
      if (!support.supported) {
        useAudioEncoder = false;
      }
    } catch {
      useAudioEncoder = false;
    }
  }

  // Use StreamTarget with chunked memory pages so large files don't require contiguous allocation
  const writtenChunks: Array<{ data: Uint8Array; position: number }> = [];
  let maxByteLength = 0;

  const muxer = new Muxer({
    target: new StreamTarget({
      onData: (data, position) => {
        const copy = new Uint8Array(data.byteLength);
        copy.set(data);
        writtenChunks.push({ data: copy, position });
        if (position + copy.byteLength > maxByteLength) {
          maxByteLength = position + copy.byteLength;
        }
      },
      chunked: true,
      chunkSize: 16 * 1024 * 1024, // 16MB stream buffer
    }),
    video: {
      codec: 'avc',
      width,
      height,
    },
    audio: useAudioEncoder
      ? {
          codec: 'aac',
          sampleRate: audioSampleRate,
          numberOfChannels: 2,
        }
      : undefined,
    fastStart: false,
  });

  let encoderError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      encoderError = err;
    },
  });

  videoEncoder.configure({
    codec: supportedH264Codec,
    width,
    height,
    bitrate: videoBitrate,
    framerate: fps,
  });

  // Encode Audio in 30-second windows first (if AudioEncoder is supported)
  if (useAudioEncoder) {
    onProgress?.(6, '合成音声トラック（速度変更・BGMフェード反映）をエンコード中...');
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        muxer.addAudioChunk(chunk, meta);
      },
      error: (err) => {
        console.warn('AudioEncoder warning:', err);
      },
    });

    audioEncoder.configure({
      codec: 'mp4a.40.2',
      sampleRate: audioSampleRate,
      numberOfChannels: 2,
      bitrate: 192_000,
    });

    const WINDOW_SEC = 30;
    for (let wStart = 0; wStart < totalDuration; wStart += WINDOW_SEC) {
      if (signal?.aborted) throw new Error('書き出しがキャンセルされました');
      const wEnd = Math.min(totalDuration, wStart + WINDOW_SEC);
      const renderedAudio = await renderAudioWindow({
        windowStart: wStart,
        windowEnd: wEnd,
        sampleRate: audioSampleRate,
        videoClips,
        bgmClips,
        decodedAudioMap,
      });

      const left = renderedAudio.getChannelData(0);
      const right =
        renderedAudio.numberOfChannels > 1
          ? renderedAudio.getChannelData(1)
          : left;

      const stepFrames = 4096;
      for (let i = 0; i < renderedAudio.length; i += stepFrames) {
        const count = Math.min(stepFrames, renderedAudio.length - i);
        const planarData = new Float32Array(count * 2);
        planarData.set(left.subarray(i, i + count), 0);
        planarData.set(right.subarray(i, i + count), count);

        const timestampUs = Math.round(
          (wStart + i / audioSampleRate) * 1_000_000
        );

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: audioSampleRate,
          numberOfFrames: count,
          numberOfChannels: 2,
          timestamp: timestampUs,
          data: planarData,
        });
        audioEncoder.encode(audioData);
        audioData.close();
      }
    }

    await audioEncoder.flush();
    audioEncoder.close();
  }

  // Prepare offscreen canvas & video element for frame-accurate rendering
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D Canvas コンテキストの初期化に失敗しました');
  }

  const feedVideo = createVideoFeeder({
    mediaAssets,
    cam2MediaId: options.cam2MediaId,
    cam2Offset: options.cam2Offset,
  });

  const totalFrames = Math.max(1, Math.ceil(totalDuration * fps));

  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    if (signal?.aborted) {
      videoEncoder.close();
      throw new Error('書き出しがキャンセルされました');
    }
    if (encoderError) {
      throw encoderError;
    }

    const timelineTime = frameIdx / fps;
    const activeClip =
      videoClips.find(
        (c) =>
          timelineTime >= c.startTime &&
          timelineTime < c.startTime + c.duration
      ) || null;

    const fed = await feedVideo(activeClip, timelineTime);
    const missingVideoFile = activeClip ? fed.missingVideoFile : false;
    const videoEl = fed.videoElement;

    renderCompositeFrame({
      ctx,
      canvasWidth: width,
      canvasHeight: height,
      aspectRatio,
      timelineTime,
      activeClip,
      videoElement: videoEl,
      subtitles,
      showSafeZone: false,
      missingVideoFile,
    });

    const timestampUs = Math.round(timelineTime * 1_000_000);
    const durationUs = Math.round((1 / fps) * 1_000_000);

    const videoFrame = new VideoFrame(canvas, {
      timestamp: timestampUs,
      duration: durationUs,
    });

    const isKeyFrame = frameIdx % (fps * 2) === 0;
    videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
    videoFrame.close();

    // Prevent encoder queue backpressure on long videos
    if (videoEncoder.encodeQueueSize > 12) {
      await videoEncoder.flush();
    }

    if (frameIdx % 5 === 0 || frameIdx === totalFrames - 1) {
      const pct = 12 + Math.round(((frameIdx + 1) / totalFrames) * 84);
      onProgress?.(
        pct,
        `MP4フレーム描画・エンコード中: ${frameIdx + 1} / ${totalFrames} フレーム (${Math.round(
          ((frameIdx + 1) / totalFrames) * 100
        )}%)`
      );
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.(97, 'MP4コンテナをファイナライズ中...');
  await videoEncoder.flush();
  videoEncoder.close();
  muxer.finalize();

  // Reconstruct final MP4 binary from stream chunks
  const finalBuffer = new Uint8Array(maxByteLength);
  for (const chunk of writtenChunks) {
    finalBuffer.set(chunk.data, chunk.position);
  }

  const mp4Blob = new Blob([finalBuffer.buffer], { type: 'video/mp4' });
  const downloadUrl = URL.createObjectURL(mp4Blob);
  const safeName =
    projectName.replace(/[^a-zA-Z0-9._-\u3000-\u9fff]/g, '_') || 'output';

  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `${safeName}.mp4`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 8000);

  onProgress?.(100, 'MP4の書き出しが完了しました！');
}
