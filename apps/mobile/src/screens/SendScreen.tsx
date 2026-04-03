import { useRef } from 'react';

import { Badge, GlassPanel } from '@dropbeam/shared-ui';
import { formatBytes } from '@dropbeam/protocol';

import { Button, Text, View } from '../lib/native.js';
import type { ReturnTypeOfUseMobileBackend } from './types.js';

export function SendScreen({ backend }: { backend: ReturnTypeOfUseMobileBackend }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const files = backend.activeSession?.files['phone-to-desktop'] ?? [];

  return (
    <GlassPanel>
      <View style={{ display: 'grid', gap: 12 }}>
        <View style={styles.row}>
          <Text style={styles.title}>Send</Text>
          <Badge tone={backend.activeSession?.pairing.verifiedAt ? 'green' : 'amber'}>
            {backend.activeSession?.pairing.verifiedAt ? 'paired' : 'pair first'}
          </Badge>
        </View>
        <Text style={styles.copy}>Choose files on the mobile client and the backend will persist them live.</Text>

        <Button
          disabled={!backend.activeSession?.pairing.verifiedAt || backend.busy === 'upload-files'}
          onPress={() => inputRef.current?.click()}
        >
          Choose files
        </Button>

        <input
          hidden
          multiple
          onChange={(event: any) => {
            if (event.target.files?.length) {
              void backend.uploadFiles(event.target.files);
              event.target.value = '';
            }
          }}
          ref={inputRef}
          type="file"
        />

        <View style={styles.list}>
          {files.length ? (
            files.map((file) => (
              <View key={file.id} style={styles.card}>
                <Text style={styles.name}>{file.name}</Text>
                <Text style={styles.meta}>{formatBytes(file.size)}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.copy}>No phone files have been uploaded yet.</Text>
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
    gap: 6,
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
