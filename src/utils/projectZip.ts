import { Zip, ZipPassThrough, ZipDeflate, unzipSync, strToU8, strFromU8 } from 'fflate';
import {
  CustomFontAsset,
  MediaAsset,
  SerializedProjectJson,
} from '../types/editor';
import { useEditorStore } from '../store/useEditorStore';

/**
 * Export the current project into a streaming `.vedit.zip` archive.
 * - `packMode === 'full'`: Includes `project.json`, all custom fonts, BGM files, AND main video files
 *   using `ZipPassThrough` (STORE mode, zero re-compression overhead) streamed in 4MB slices so
 *   multi-GB videos do not exhaust RAM.
 * - `packMode === 'lightweight'`: Includes `project.json`, all custom fonts, and BGM files;
 *   omits heavy video binaries so the `.zip` is tiny and fast, and prompts the user to re-select
 *   the original video file upon import.
 */
export async function exportProjectToZip(
  packMode: 'full' | 'lightweight',
  onProgress?: (percent: number, message: string) => void
): Promise<void> {
  const state = useEditorStore.getState();
  onProgress?.(5, 'プロジェクト構成データを生成中...');

  const mediaMetadata: SerializedProjectJson['mediaMetadata'] = [];
  const fontMetadata: SerializedProjectJson['fontMetadata'] = [];

  for (const asset of state.mediaAssets) {
    const shouldInclude =
      Boolean(asset.file) && (packMode === 'full' || asset.type === 'bgm');
    const safeName = asset.name.replace(/[^a-zA-Z0-9._-\u3000-\u9fff]/g, '_');
    const zipPath = shouldInclude
      ? `media/${asset.id}_${safeName}`
      : undefined;

    mediaMetadata.push({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      duration: asset.duration,
      width: asset.width,
      height: asset.height,
      sizeBytes: asset.sizeBytes,
      mimeType: asset.mimeType,
      waveformPeaks: asset.waveformPeaks,
      waveformSampleRate: asset.waveformSampleRate,
      rawWaveformRms: asset.rawWaveformRms,
      audioStats: asset.audioStats,
      includedInZip: shouldInclude,
      zipPath,
    });
  }

  for (const font of state.customFonts) {
    const safeFileName = font.fileName.replace(
      /[^a-zA-Z0-9._-\u3000-\u9fff]/g,
      '_'
    );
    const zipPath = `fonts/${font.id}_${safeFileName}`;
    fontMetadata.push({
      id: font.id,
      name: font.name,
      fileName: font.fileName,
      format: font.format,
      zipPath,
    });
  }

  const projectJson: SerializedProjectJson = {
    version: '1.0.0',
    projectName: state.projectName,
    aspectRatio: state.aspectRatio,
    packMode,
    createdAt: new Date().toISOString(),
    videoClips: state.videoClips,
    subtitles: state.subtitles,
    bgmClips: state.bgmClips,
    defaultSubtitleStyle: state.defaultSubtitleStyle,
    silenceConfig: state.silenceConfig,
    cam2MediaId: state.cam2MediaId,
    cam2Offset: state.cam2Offset,
    mediaMetadata,
    fontMetadata,
  };

  // Collect output Blob chunks via streaming fflate.Zip
  const outputBlobParts: BlobPart[] = [];
  let zipError: Error | null = null;

  const zip = new Zip((err, chunk) => {
    if (err) {
      zipError = err;
      return;
    }
    // Copy chunk buffer slice to avoid detached buffer reuse
    const copied = new Uint8Array(chunk.byteLength);
    copied.set(chunk);
    outputBlobParts.push(copied.buffer);
  });

  // 1. Add project.json (compressed)
  const jsonStream = new ZipDeflate('project.json', { level: 6 });
  zip.add(jsonStream);
  jsonStream.push(strToU8(JSON.stringify(projectJson, null, 2)), true);

  // 2. Add Custom Fonts
  for (let i = 0; i < state.customFonts.length; i++) {
    const font = state.customFonts[i];
    const meta = fontMetadata[i];
    onProgress?.(15, `フォントを格納中: ${font.name}`);
    const fontFileStream = new ZipPassThrough(meta.zipPath);
    zip.add(fontFileStream);
    fontFileStream.push(new Uint8Array(font.data), true);
  }

  // 3. Stream Media Files (4MB slices for memory safety on huge videos)
  const includedMedia = state.mediaAssets.filter((m, idx) =>
    Boolean(m.file && mediaMetadata[idx].includedInZip)
  );

  const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB per slice

  for (let idx = 0; idx < includedMedia.length; idx++) {
    const asset = includedMedia[idx];
    const meta = mediaMetadata.find((m) => m.id === asset.id);
    if (!asset.file || !meta?.zipPath) continue;

    // Use ZipPassThrough (STORE mode) because MP4/MP3/AAC are already compressed
    const mediaStream = new ZipPassThrough(meta.zipPath);
    zip.add(mediaStream);

    const fileSize = asset.file.size;
    let offset = 0;

    while (offset < fileSize) {
      const end = Math.min(offset + CHUNK_SIZE, fileSize);
      const isLast = end >= fileSize;
      const sliceBuffer = await asset.file.slice(offset, end).arrayBuffer();
      mediaStream.push(new Uint8Array(sliceBuffer), isLast);
      offset = end;

      const mediaProgress =
        20 + Math.round(((idx + offset / fileSize) / includedMedia.length) * 75);
      onProgress?.(
        mediaProgress,
        `メディア書き出し中: ${asset.name} (${Math.round(
          (offset / fileSize) * 100
        )}%)`
      );
    }
  }

  zip.end();

  if (zipError) {
    throw zipError;
  }

  onProgress?.(98, 'ZIPファイルを生成しています...');
  const finalBlob = new Blob(outputBlobParts, { type: 'application/zip' });
  const url = URL.createObjectURL(finalBlob);
  const safeProjName =
    state.projectName.replace(/[^a-zA-Z0-9._-\u3000-\u9fff]/g, '_') || 'project';
  const suffix = packMode === 'lightweight' ? '.light.vedit.zip' : '.vedit.zip';

  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeProjName}${suffix}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  onProgress?.(100, 'プロジェクトZIPの保存が完了しました');
}

/**
 * Import and restore a `.vedit.zip` or `.zip` project archive.
 * Automatically re-registers custom fonts via `FontFace` API and reconstructs ObjectURLs.
 */
export async function importProjectFromZip(
  zipFile: File,
  onProgress?: (percent: number, message: string) => void
): Promise<{ missingVideoCount: number }> {
  onProgress?.(10, 'ZIPアーカイブを展開中...');
  const buffer = await zipFile.arrayBuffer();
  const unzipped = unzipSync(new Uint8Array(buffer));

  const projectJsonBytes = unzipped['project.json'];
  if (!projectJsonBytes) {
    throw new Error(
      '有効な project.json がZIP内に見つかりませんでした。CloudCut Pro のプロジェクトZIPを選択してください。'
    );
  }

  const projectData = JSON.parse(
    strFromU8(projectJsonBytes)
  ) as SerializedProjectJson;

  const store = useEditorStore.getState();

  // 1. Restore Custom Fonts and register with FontFace API
  const restoredFonts: CustomFontAsset[] = [];
  for (const fontMeta of projectData.fontMetadata || []) {
    const fontBytes = unzipped[fontMeta.zipPath];
    if (!fontBytes) continue;

    onProgress?.(35, `カスタムフォントを復元中: ${fontMeta.name}`);
    const arrayBuf = fontBytes.buffer.slice(
      fontBytes.byteOffset,
      fontBytes.byteOffset + fontBytes.byteLength
    ) as ArrayBuffer;

    const fontAsset: CustomFontAsset = {
      id: fontMeta.id,
      name: fontMeta.name,
      fileName: fontMeta.fileName,
      format: fontMeta.format,
      data: arrayBuf,
    };

    try {
      const face = new FontFace(fontAsset.name, arrayBuf.slice(0));
      const loaded = await face.load();
      document.fonts.add(loaded);
    } catch (err) {
      console.warn('Could not re-register font face:', fontAsset.name, err);
    }
    restoredFonts.push(fontAsset);
  }

  // 2. Restore Media Assets & Object URLs
  const restoredMedia: MediaAsset[] = [];
  let missingVideoCount = 0;

  for (const meta of projectData.mediaMetadata || []) {
    onProgress?.(65, `メディアを復元中: ${meta.name}`);
    if (meta.includedInZip && meta.zipPath && unzipped[meta.zipPath]) {
      const rawBytes = unzipped[meta.zipPath];
      const copiedBytes = new Uint8Array(rawBytes.byteLength);
      copiedBytes.set(rawBytes);
      const blob = new Blob([copiedBytes.buffer], {
        type: meta.mimeType || (meta.type === 'video' ? 'video/mp4' : 'audio/mpeg'),
      });
      const file = new File([blob], meta.name, {
        type: blob.type,
      });
      const objectUrl = URL.createObjectURL(file);

      restoredMedia.push({
        id: meta.id,
        name: meta.name,
        type: meta.type,
        file,
        objectUrl,
        duration: meta.duration,
        width: meta.width,
        height: meta.height,
        sizeBytes: meta.sizeBytes,
        mimeType: meta.mimeType,
        waveformPeaks: meta.waveformPeaks || [],
        waveformSampleRate: meta.waveformSampleRate || 50,
        rawWaveformRms: meta.rawWaveformRms,
        audioStats: meta.audioStats,
        missingFile: false,
      });
    } else {
      // Lightweight pack where video file needs re-selection by user
      if (meta.type === 'video') {
        missingVideoCount++;
      }
      restoredMedia.push({
        id: meta.id,
        name: meta.name,
        type: meta.type,
        objectUrl: '',
        duration: meta.duration,
        width: meta.width,
        height: meta.height,
        sizeBytes: meta.sizeBytes,
        mimeType: meta.mimeType,
        waveformPeaks: meta.waveformPeaks || [],
        waveformSampleRate: meta.waveformSampleRate || 50,
        rawWaveformRms: meta.rawWaveformRms,
        audioStats: meta.audioStats,
        missingFile: true,
      });
    }
  }

  onProgress?.(95, 'タイムラインとテロップ状態を復元中...');
  store.loadProjectState({
    projectName: projectData.projectName || '復元されたプロジェクト',
    aspectRatio: projectData.aspectRatio || '16:9',
    mediaAssets: restoredMedia,
    customFonts: restoredFonts,
    videoClips: projectData.videoClips || [],
    subtitles: projectData.subtitles || [],
    bgmClips: projectData.bgmClips || [],
    defaultSubtitleStyle:
      projectData.defaultSubtitleStyle || store.defaultSubtitleStyle,
    silenceConfig: projectData.silenceConfig || store.silenceConfig,
    cam2MediaId:
      projectData.cam2MediaId &&
      restoredMedia.some((m) => m.id === projectData.cam2MediaId)
        ? projectData.cam2MediaId
        : null,
    cam2Offset: projectData.cam2Offset ?? 0,
  });

  onProgress?.(100, 'プロジェクトの読み込みが完了しました');
  return { missingVideoCount };
}

