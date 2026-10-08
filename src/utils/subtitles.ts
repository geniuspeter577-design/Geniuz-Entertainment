export type SubtitleFormat = 'srt' | 'vtt';

export type SubtitleCue = {
  startSeconds: number;
  endSeconds: number;
  text: string;
};

const MAX_SUBTITLE_FILE_BYTES = 2 * 1024 * 1024;

function isSubtitleFormat(value: string | undefined): value is SubtitleFormat {
  return value === 'srt' || value === 'vtt';
}

export function validateSubtitleFile(name: string, sizeBytes: number) {
  const extension = /\.([^.]+)$/.exec(name.trim().toLowerCase())?.[1];
  if (!isSubtitleFormat(extension)) {
    return { valid: false as const, message: 'Choose an .srt or .vtt subtitle file.' };
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_SUBTITLE_FILE_BYTES) {
    return { valid: false as const, message: 'Subtitle files must be between 1 byte and 2 MB.' };
  }
  return { valid: true as const, format: extension };
}

function parseTimestamp(raw: string) {
  const timestamp = raw.trim().replace(',', '.');
  const parts = timestamp.split(':');
  if (parts.length !== 2 && parts.length !== 3) {
    return undefined;
  }
  const [hours, minutes, seconds] =
    parts.length === 3 ? parts : ['0', parts[0], parts[1]];
  const parsedHours = Number(hours);
  const parsedMinutes = Number(minutes);
  const parsedSeconds = Number(seconds);
  if (
    !Number.isInteger(parsedHours) ||
    parsedHours < 0 ||
    !Number.isInteger(parsedMinutes) ||
    parsedMinutes < 0 ||
    parsedMinutes >= 60 ||
    !Number.isFinite(parsedSeconds) ||
    parsedSeconds < 0 ||
    parsedSeconds >= 60
  ) {
    return undefined;
  }
  return parsedHours * 3600 + parsedMinutes * 60 + parsedSeconds;
}

function cleanCueText(lines: readonly string[]) {
  return lines
    .join('\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim();
}

export function parseSubtitleFile(contents: string, format: SubtitleFormat): SubtitleCue[] {
  const lines = contents.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const cues: SubtitleCue[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const timingLineIndex =
      lines[index].includes('-->') ? index : lines[index + 1]?.includes('-->') ? index + 1 : -1;
    if (timingLineIndex < 0) {
      continue;
    }
    const timing = lines[timingLineIndex].split('-->');
    const startSeconds = parseTimestamp(timing[0]);
    const endSeconds = parseTimestamp(timing[1].trim().split(/\s+/, 1)[0] ?? '');
    if (
      startSeconds === undefined ||
      endSeconds === undefined ||
      endSeconds <= startSeconds
    ) {
      continue;
    }
    const textLines: string[] = [];
    let textIndex = timingLineIndex + 1;
    while (textIndex < lines.length && lines[textIndex].trim()) {
      textLines.push(lines[textIndex]);
      textIndex += 1;
    }
    const text = cleanCueText(textLines);
    if (text) {
      cues.push({ startSeconds, endSeconds, text });
    }
    index = textIndex;
  }

  if (format === 'vtt' && !/^\s*WEBVTT(?:\s|$)/i.test(contents.replace(/^\uFEFF/, ''))) {
    throw new Error('The VTT subtitle file is missing its WEBVTT header.');
  }
  if (!cues.length) {
    throw new Error('The subtitle file does not contain any valid captions.');
  }
  return cues.sort((left, right) => left.startSeconds - right.startSeconds);
}

export function findSubtitleCue(cues: readonly SubtitleCue[], positionSeconds: number) {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
    return undefined;
  }
  let low = 0;
  let high = cues.length - 1;
  let candidate = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (cues[middle].startSeconds <= positionSeconds) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  for (let index = candidate; index >= 0; index -= 1) {
    if (cues[index].startSeconds <= positionSeconds && positionSeconds < cues[index].endSeconds) {
      return cues[index];
    }
    if (cues[index].endSeconds <= positionSeconds) {
      break;
    }
  }
  return undefined;
}
