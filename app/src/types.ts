import { Request } from 'express-serve-static-core'

export enum AssetType {
  image = 'IMAGE',
  video = 'VIDEO'
}

export enum KeyType {
  key = 'key',
  slug = 'slug'
}

export interface ExifInfo {
  description?: string;
}

export enum AlbumType {
  album = 'ALBUM',
  individual = 'INDIVIDUAL'
}

export interface Asset {
  id: string;
  key: string;
  keyType: KeyType;
  originalFileName?: string;
  originalMimeType: string;
  password?: string;
  fileCreatedAt?: string; // May not exist - see https://github.com/alangrainger/immich-public-proxy/issues/61
  type: AssetType;
  isTrashed: boolean;
  exifInfo?: ExifInfo;
  livePhotoVideoId?: string | null; // NEW - opaque UUID, needed for Live Photo pairing
}

export interface Album {
  id: string;
  assets: Asset[];
}

export interface PublicAsset {
  id: string                      // already in HTML as href/src
  type: 'image' | 'video'         // already implied by HTML structure
  originalFileName: string        // already in data-download attribute
  livePhotoVideoId: string | null // NEW - opaque UUID, needed for Live Photo pairing
  description: string             // already in data-sub-html (empty if config disables it)
}
 
export interface PublicShareResponse {
  title: string        // already in page <title>
  description: string  // already on page (empty if ipp.showGalleryDescription is false)
  thumbnail?: string | null; // NEW - ID for the thumbnail image, needed for the gallery cover photo
  assets: PublicAsset[]
}

export interface SharedLink {
  key: string;
  keyType: KeyType;
  type: string;
  description?: string;
  assets: Asset[];
  allowDownload?: boolean;
  password?: string;
  album?: {
    id: string;
    albumName?: string;
    order?: string;
    description?: string;
    albumThumbnailAssetId?: string;
  }
  expiresAt: string | null;
}

export interface SharedLinkResult {
  valid: boolean;
  key?: string;
  passwordRequired?: boolean;
  link?: SharedLink;
}

export enum ImageSize {
  thumbnail = 'thumbnail',
  preview = 'preview',
  original = 'original'
}

export interface IncomingShareRequest {
  req: Request;
  key: string;
  keyType?: KeyType;
  password?: string;
  mode?: string;
  size?: ImageSize;
  range?: string;
}

export enum DownloadAll {
  disabled,
  perImmich,
  always
}
