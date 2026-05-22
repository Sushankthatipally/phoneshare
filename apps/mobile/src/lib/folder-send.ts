import { NativeModules, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

interface DropBeamAndroidFolderModule {
  pickFolder?: () => Promise<{ treeUri: string } | null>;
  listFolderContents?: (input: { treeUri: string }) => Promise<{
    files: Array<{ uri: string; name: string; relativePath: string; mimeType: string; size: number }>;
  }>;
}

function getModule(): DropBeamAndroidFolderModule | null {
  if (Platform.OS !== 'android') return null;
  const mod = NativeModules?.DropBeamAndroid as DropBeamAndroidFolderModule | undefined;
  return mod ?? null;
}

export interface FolderFile {
  uri: string;
  name: string;
  relativePath: string;
  mimeType: string;
  size: number;
}

export interface FolderPickResult {
  files: FolderFile[];
  /** Free-form note surfaced to the UI (e.g. iCloud-only on iOS). */
  note?: string;
}

/**
 * Cross-platform folder picker:
 * - Android: uses Storage Access Framework via the native `DropBeamAndroid`
 *   module, then walks the picked tree to flatten files (preserving the
 *   relative path).
 * - iOS: SAF is not available; we fall back to `expo-document-picker` with
 *   `multiple: true`. The caller surfaces a hint explaining the limitation.
 *
 * Returns null if the user cancels.
 */
export async function pickFolderFiles(): Promise<FolderPickResult | null> {
  const mod = getModule();
  if (mod?.pickFolder && mod.listFolderContents) {
    const result = await mod.pickFolder();
    if (!result?.treeUri) return null;
    const listing = await mod.listFolderContents({ treeUri: result.treeUri });
    return { files: listing.files ?? [] };
  }

  // iOS fallback: multi-pick from the Files app. iCloud Drive folders are
  // accessible but arbitrary local folders are not.
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
    type: '*/*',
  });
  if (picked.canceled) return null;
  const files: FolderFile[] = [];
  for (const asset of picked.assets) {
    let size = asset.size ?? 0;
    if (!size) {
      try {
        const info = await FileSystem.getInfoAsync(asset.uri, { size: true });
        if (info.exists) size = (info as { size?: number }).size ?? 0;
      } catch {
        /* skip */
      }
    }
    files.push({
      uri: asset.uri,
      name: asset.name,
      relativePath: asset.name,
      mimeType: asset.mimeType ?? 'application/octet-stream',
      size,
    });
  }
  return {
    files,
    note:
      Platform.OS === 'ios'
        ? 'iOS folder send is limited to files picked through iCloud Drive. Pick multiple files to mimic a folder.'
        : undefined,
  };
}
