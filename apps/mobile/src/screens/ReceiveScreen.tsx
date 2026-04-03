import { Badge, GlassPanel } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import { Button, Text, View } from '../lib/native.js';
import type { ReturnTypeOfUseMobileBackend } from './types.js';

export function ReceiveScreen({ backend }: { backend: ReturnTypeOfUseMobileBackend }) {
  const files = backend.activeSession?.files['desktop-to-phone'] ?? [];
  const openDownload = (fileId: string) => {
    const url = backend.downloadUrl(fileId);
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <GlassPanel>
      <View style={{ display: 'grid', gap: 12 }}>
        <View style={styles.row}>
          <Text style={styles.title}>Receive</Text>
          <Badge tone="blue">{files.length ? `${files.length} files` : 'waiting'}</Badge>
        </View>
        <Text style={styles.copy}>Desktop uploads show up here as live session state changes.</Text>

        <View style={styles.list}>
          {files.length ? (
            files.map((file) => (
              <View key={file.id} style={styles.card}>
                <Text style={styles.name}>{file.name}</Text>
                <Text style={styles.meta}>{formatBytes(file.size)}</Text>
                <Button onPress={() => openDownload(file.id)}>Download</Button>
              </View>
            ))
          ) : (
            <Text style={styles.copy}>No desktop files are ready for this phone yet.</Text>
          )}
        </View>
      </View>
    </GlassPanel>
  );
}

const styles = {
  row: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#f2f7ff',
    fontSize: 22,
    fontWeight: 800,
  },
  copy: {
    color: '#a9bfd3',
    lineHeight: 1.5,
  },
  list: {
    display: 'grid',
    gap: 10,
  },
  card: {
    backgroundColor: '#0c1625',
    border: '1px solid #1e2f44',
    borderRadius: 18,
    display: 'grid',
    gap: 8,
    padding: 12,
  },
  name: {
    color: '#eef6ff',
    fontWeight: 700,
  },
  meta: {
    color: '#99b4c9',
  },
};
