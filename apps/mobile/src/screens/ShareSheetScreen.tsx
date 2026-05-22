import { useState } from 'react';

import { ScreenCard } from '../components/ScreenCard.js';
import { Button, Pressable, Text, View } from '../lib/native.js';

interface ShareTarget {
  id: string;
  name: string;
  lastUsed?: string;
}

interface ShareSheetScreenProps {
  fileName: string;
  fileSize: string;
  targets: ShareTarget[];
  onSend: (target: ShareTarget) => void;
  onCancel: () => void;
}

export function ShareSheetScreen({ fileName, fileSize, targets, onSend, onCancel }: ShareSheetScreenProps) {
  const [selected, setSelected] = useState(targets[0]?.id ?? '');
  const target = targets.find((t) => t.id === selected) ?? targets[0];

  return (
    <View style={{ gap: 14 }}>
      <ScreenCard eyebrow="Share via DropBeam" title={fileName} copy={`${fileSize} · choose a connected device`}>
        <View style={{ gap: 8, marginTop: 8 }}>
          {targets.map((option) => {
            const isSelected = selected === option.id;
            return (
              <Pressable
                key={option.id}
                onPress={() => setSelected(option.id)}
                style={[
                  styles.targetCard,
                  isSelected ? styles.targetCardSelected : null,
                ]}
              >
                <Text style={styles.targetName}>{option.name}</Text>
                {option.lastUsed ? <Text style={styles.targetMeta}>Last used {option.lastUsed}</Text> : null}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.actionRow}>
          <View style={{ flex: 1 }}>
            <Button onPress={() => target && onSend(target)}>Send to {target?.name ?? '...'}</Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button onPress={onCancel}>Cancel</Button>
          </View>
        </View>
      </ScreenCard>
    </View>
  );
}

const styles = {
  targetCard: {
    backgroundColor: '#0c1625',
    borderColor: '#1e2f44',
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  targetCardSelected: {
    backgroundColor: '#10263d',
    borderColor: '#3aa9ff',
  },
  targetName: {
    color: '#eef6ff',
    fontWeight: '700' as const,
  },
  targetMeta: {
    color: '#a9bfd3',
    fontSize: 12,
  },
  actionRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
    marginTop: 12,
  },
};
