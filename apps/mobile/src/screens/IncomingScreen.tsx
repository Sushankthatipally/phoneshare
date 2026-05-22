import { ScreenCard } from '../components/ScreenCard.js';
import { Button, Text, View } from '../lib/native.js';

interface IncomingFile {
  id: string;
  name: string;
  sizeLabel: string;
}

interface IncomingScreenProps {
  sender: string;
  files: IncomingFile[];
  onAcceptAll: () => void;
  onAcceptSome: (ids: string[]) => void;
  onDecline: () => void;
}

export function IncomingScreen({ sender, files, onAcceptAll, onAcceptSome, onDecline }: IncomingScreenProps) {
  return (
    <View style={{ gap: 14 }}>
      <ScreenCard
        eyebrow="Incoming"
        title={`📥 ${sender} wants to send ${files.length} file${files.length === 1 ? '' : 's'}`}
        copy="Tap Accept All to receive everything, Accept Some to pick which files, or Decline to ignore."
      >
        <View style={{ gap: 8 }}>
          {files.map((file) => (
            <View key={file.id} style={styles.fileCard}>
              <Text style={styles.fileName}>{file.name}</Text>
              <Text style={styles.fileSize}>{file.sizeLabel}</Text>
            </View>
          ))}
        </View>

        <View style={styles.actionRow}>
          <View style={{ flex: 1, minWidth: 100 }}>
            <Button onPress={onAcceptAll}>Accept All</Button>
          </View>
          <View style={{ flex: 1, minWidth: 100 }}>
            <Button onPress={() => onAcceptSome(files.map((f) => f.id))}>Accept Some</Button>
          </View>
          <View style={{ flex: 1, minWidth: 100 }}>
            <Button onPress={onDecline}>Decline</Button>
          </View>
        </View>
      </ScreenCard>
    </View>
  );
}

const styles = {
  fileCard: {
    backgroundColor: '#0c1625',
    borderColor: '#1e2f44',
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  fileName: {
    color: '#eef6ff',
    fontWeight: '700' as const,
  },
  fileSize: {
    color: '#a9bfd3',
    fontSize: 13,
  },
  actionRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
    marginTop: 12,
  },
};
