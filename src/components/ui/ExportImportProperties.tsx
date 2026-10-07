import { Progress } from './AppProperties';

export enum FileFormats {
  Jpeg = 'jpeg',
  Png = 'png',
  Tiff = 'tiff',
  Webp = 'webp',
  Jxl = 'jxl',
  Avif = 'avif',
  Cube = 'cube',
}

export const FILE_FORMATS: Array<FileFormat> = [
  { id: FileFormats.Jpeg, name: 'JPEG', extensions: ['jpg', 'jpeg'] },
  { id: FileFormats.Png, name: 'PNG', extensions: ['png'] },
  { id: FileFormats.Tiff, name: 'TIFF', extensions: ['tiff'] },
  { id: FileFormats.Webp, name: 'WebP', extensions: ['webp'] },
  { id: FileFormats.Jxl, name: 'JPEG XL', extensions: ['jxl'] },
  { id: FileFormats.Avif, name: 'AVIF', extensions: ['avif'] },
  { id: FileFormats.Cube, name: 'CUBE LUT', extensions: ['cube'] },
];

export interface FilenameToken {
  token: string;
  key: string;
}

export interface FilenameTokenGroup {
  id: string;
  exportOnly?: boolean;
  tokens: ReadonlyArray<FilenameToken>;
}

export const FILENAME_TOKEN_GROUPS = [
  {
    id: 'file',
    tokens: [
      { token: '{original_filename}', key: 'originalFilename' },
      { token: '{original_ext}', key: 'originalExt' },
      { token: '{folder}', key: 'folder' },
    ],
  },
  {
    id: 'sequence',
    tokens: [
      { token: '{sequence}', key: 'sequence' },
      { token: '{sequence:3}', key: 'sequencePadded' },
      { token: '{total}', key: 'total' },
    ],
  },
  {
    id: 'captureDate',
    tokens: [
      { token: '{date}', key: 'date' },
      { token: '{time}', key: 'time' },
      { token: '{YYYY}', key: 'year' },
      { token: '{YY}', key: 'yearShort' },
      { token: '{MM}', key: 'month' },
      { token: '{Month}', key: 'monthName' },
      { token: '{Mon}', key: 'monthShort' },
      { token: '{DD}', key: 'day' },
      { token: '{hh}', key: 'hour' },
      { token: '{mm}', key: 'minute' },
      { token: '{ss}', key: 'second' },
      { token: '{subsec}', key: 'subsec' },
    ],
  },
  {
    id: 'exportDate',
    exportOnly: true,
    tokens: [
      { token: '{export_date}', key: 'exportDate' },
      { token: '{export_time}', key: 'exportTime' },
    ],
  },
  {
    id: 'camera',
    tokens: [
      { token: '{make}', key: 'make' },
      { token: '{model}', key: 'model' },
      { token: '{lens}', key: 'lens' },
      { token: '{iso}', key: 'iso' },
      { token: '{focal}', key: 'focal' },
      { token: '{aperture}', key: 'aperture' },
      { token: '{shutter}', key: 'shutter' },
      { token: '{serial}', key: 'serial' },
    ],
  },
  {
    id: 'metadata',
    tokens: [
      { token: '{title}', key: 'title' },
      { token: '{author}', key: 'author' },
      { token: '{copyright}', key: 'copyright' },
      { token: '{comments}', key: 'comments' },
      { token: '{rating}', key: 'rating' },
      { token: '{label}', key: 'label' },
      { token: '{flag}', key: 'flag' },
    ],
  },
  {
    id: 'custom',
    exportOnly: true,
    tokens: [
      { token: '{text}', key: 'text' },
      { token: '{preset}', key: 'preset' },
    ],
  },
] as const satisfies ReadonlyArray<FilenameTokenGroup>;

export const FILENAME_SCHEMES = [
  { id: 'filename', template: '{original_filename}' },
  { id: 'filenameEdited', template: '{original_filename}_edited' },
  { id: 'filenameSequence', template: '{original_filename}_{sequence}' },
  { id: 'dateFilename', template: '{date}_{original_filename}' },
  { id: 'customSequence', template: '{text}_{sequence}' },
  { id: 'customName', template: '{text}' },
  { id: 'custom', template: null },
] as const satisfies ReadonlyArray<{ id: string; template: string | null }>;

export const withSequenceFallback = (template: string, fileCount: number) =>
  fileCount > 1 && !template.includes('{sequence') && !template.includes('{original_filename}')
    ? `${template}_{sequence}`
    : template;

export enum FilenameCase {
  AsIs = 'asIs',
  Lower = 'lower',
  Upper = 'upper',
}

export interface FilenameSettings {
  filenameTemplate: string | null;
  sequenceStart?: number;
  customText?: string;
  filenameCase?: FilenameCase;
  presetName?: string;
}

export type TiffBitDepth = 8 | 16;

export interface ExportSettings extends FilenameSettings {
  jpegQuality: number;
  tiffBitDepth: TiffBitDepth;
  keepMetadata: boolean;
  preserveTimestamps: boolean;
  resize: {
    mode: string;
    value: number;
    dontEnlarge: boolean;
  } | null;
  border: {
    basis: BorderBasis;
    horizontalPercent: number;
    verticalPercent: number;
    color: string;
  } | null;
  pad: {
    ratioWidth: number;
    ratioHeight: number;
    color: string;
  } | null;
  stripGps: boolean;
  watermark: WatermarkSettings | null;
  exportMasks?: boolean;
  preserveFolders?: boolean;
  destinationType?: string;
  subfolder?: string;
}

export enum BorderBasis {
  LongEdge = 'longEdge',
  ShortEdge = 'shortEdge',
  EachEdge = 'eachEdge',
}

export enum WatermarkAnchor {
  TopLeft = 'topLeft',
  TopCenter = 'topCenter',
  TopRight = 'topRight',
  CenterLeft = 'centerLeft',
  Center = 'center',
  CenterRight = 'centerRight',
  BottomLeft = 'bottomLeft',
  BottomCenter = 'bottomCenter',
  BottomRight = 'bottomRight',
}

interface WatermarkSettings {
  path: string;
  anchor: WatermarkAnchor;
  scale: number;
  spacing: number;
  opacity: number;
}

export interface ExportState {
  errorMessage: string;
  progress: Progress;
  status: Status;
}

export interface FileFormat {
  extensions: Array<string>;
  id: string;
  name: string;
}

export interface ImportState {
  errorMessage: string;
  path?: string;
  progress?: Progress;
  status: Status;
}

export enum Status {
  Cancelled = 'cancelled',
  Cancelling = 'cancelling',
  Exporting = 'exporting',
  Error = 'error',
  Idle = 'idle',
  Importing = 'importing',
  Success = 'success',
}

export interface ExportPreset extends Omit<FilenameSettings, 'filenameTemplate'> {
  id: string;
  name: string;
  fileFormat: string;
  jpegQuality: number;
  tiffBitDepth?: TiffBitDepth;
  enableResize: boolean;
  resizeMode: string;
  resizeValue: number;
  dontEnlarge: boolean;
  enablePad?: boolean;
  padRatioWidth?: number;
  padRatioHeight?: number;
  padColor?: string;
  enableBorder?: boolean;
  borderBasis?: string;
  borderHorizontalPercent?: number;
  borderVerticalPercent?: number;
  borderColor?: string;
  keepMetadata: boolean;
  preserveTimestamps: boolean;
  stripGps: boolean;
  exportMasks?: boolean;
  preserveFolders?: boolean;
  filenameTemplate: string;
  enableWatermark: boolean;
  watermarkPath: string | null;
  watermarkAnchor: string;
  watermarkScale: number;
  watermarkSpacing: number;
  watermarkOpacity: number;
  lastExportPath?: string;
  destinationType?: string;
  subfolder?: string;
}
