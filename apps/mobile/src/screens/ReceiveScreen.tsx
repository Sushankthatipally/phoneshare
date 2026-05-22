import { ScreenCard } from '../components/ScreenCard.js';
import { Button, Text, View } from '../lib/native.js';
import type { ReturnTypeOfUseMobileBackend } from './types.js';

export function ReceiveScreen({ backend }: { backend: ReturnTypeOfUseMobileBackend }) {
  return (
    <View style={{ gap: 14 }}>
      <ScreenCard
        eyebrow="Incoming"
        title="Approve desktop files"
        copy="The receive lane keeps the approval surface visible without needing a browser fallback."
      >
        <View style={styles.actionGrid}>
          <View style={{ width: '48%' }}>
            <Button onPress={() => backend.markHistory('Receipt scan.pdf', 780_000, 'desktop-to-phone', 'wifi')}>
              Approve sample
            </Button>
          </View>
          <View style={{ width: '48%' }}>
            <Button onPress={() => backend.selectConnectionMode('hotspot')}>Use hotspot link</Button>
          </View>
        </View>
      </ScreenCard>

      <ScreenCard
        eyebrow="Pending"
        title="Waiting for approvals"
        copy="Incoming transfer cards will land here once the native transport module is connected."
      >
        <View style={styles.jobList}>
          <View style={styles.jobCard}>
            <Text style={styles.jobName}>Shared design assets</Text>
            <Text style={styles.jobMeta}>12.4 MB · wifi · queued for approval</Text>
            <Text style={styles.copy}>The native receive flow will show trust, progress, and save location here.</Text>
          </View>
          <View style={styles.jobCard}>
            <Text style={styles.jobName}>Recording clip.mp4</Text>
            <Text style={styles.jobMeta}>84.2 MB · hotspot · waiting on host</Text>
            <Text style={styles.copy}>Hotspot mode is scaffolded for the Android path and should share the same wire contract.</Text>
          </View>
        </View>
      </ScreenCard>
    </View>
  );
}

const styles = {
  actionGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
  },
  jobList: {
    gap: 10,
  },
  jobCard: {
    backgroundColor: '#0c1625',
    borderColor: '#1e2f44',
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  jobName: {
    color: '#eef6ff',
    fontSize: 15,
    fontWeight: '700' as const,
  },
  jobMeta: {
    color: '#99b4c9',
    lineHeight: 18,
  },
  copy: {
    color: '#a9bfd3',
    lineHeight: 20,
  },
};
