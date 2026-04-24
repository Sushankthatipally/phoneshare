import { ScreenCard } from '../components/ScreenCard.js';
import { Button, Text, View } from '../lib/native.js';
import { formatBytes } from '../services/transfer.js';
import type { ReturnTypeOfUseMobileBackend } from './types.js';

export function SendScreen({ backend }: { backend: ReturnTypeOfUseMobileBackend }) {
  return (
    <View style={{ display: 'grid', gap: 14 }}>
      <ScreenCard
        eyebrow="Outgoing"
        title="Queue files for transfer"
        copy="The native picker module will land next. For now the scaffold shows how the transfer queue, chunk sizes, and progress will read."
      >
        <View style={styles.actionGrid}>
          <Button onPress={() => backend.queueFiles([{ name: 'Camera roll export.jpg', size: 8_600_000 }])}>
            Queue photo
          </Button>
          <Button onPress={() => backend.queueFiles([{ name: 'Project notes.pdf', size: 1_200_000 }])}>
            Queue document
          </Button>
        </View>

        <Text style={styles.copy}>Chunk size negotiated by metadata: {backend.chunkSizeLabel}</Text>
      </ScreenCard>

      <ScreenCard eyebrow="Transfer jobs" title="Sending queue" copy="Each job will become a native TCP transfer once the modules are wired.">
        <View style={styles.jobList}>
          {backend.transfers.map((job) => (
            <View key={job.id} style={styles.jobCard}>
              <View style={styles.jobHeader}>
                <Text style={styles.jobName}>{job.name}</Text>
                <Text style={styles.jobState}>{job.state}</Text>
              </View>
              <Text style={styles.jobMeta}>
                {job.sizeLabel} · {job.mode} · chunks of {job.chunkSizeLabel}
              </Text>
              <View style={styles.progressTrack}>
                <View style={{ ...styles.progressFill, width: `${Math.max(12, job.progress)}%` }} />
              </View>
              <View style={styles.footerRow}>
                <Text style={styles.jobMeta}>{formatBytes(job.size)}</Text>
                <Button onPress={() => backend.advanceTransfer(job.id)}>Mark complete</Button>
              </View>
            </View>
          ))}
        </View>
      </ScreenCard>
    </View>
  );
}

const styles = {
  actionGrid: {
    display: 'grid',
    gap: 10,
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  },
  copy: {
    color: '#a9bfd3',
    lineHeight: 1.5,
  },
  jobList: {
    display: 'grid',
    gap: 10,
  },
  jobCard: {
    backgroundColor: '#0c1625',
    border: '1px solid #1e2f44',
    borderRadius: 18,
    display: 'grid',
    gap: 10,
    padding: 12,
  },
  jobHeader: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
  },
  jobName: {
    color: '#eef6ff',
    fontSize: 15,
    fontWeight: 700,
  },
  jobState: {
    color: '#89b7d1',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
  jobMeta: {
    color: '#99b4c9',
    lineHeight: 1.4,
  },
  progressTrack: {
    backgroundColor: '#122338',
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
  progressFill: {
    background: 'linear-gradient(90deg, #3aa9ff 0%, #8be0ff 100%)',
    borderRadius: 999,
    height: '100%',
  },
  footerRow: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
  },
};
